//! One bounded Agent Builder investigation turn. The worker owns the scoped
//! tool bridge, transcript, turn limit and payment-decision validation.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};

use crate::Kibana;

// The evidence-request protocol must not replace assets still used by v1 workers.
pub const WORKFLOW: &str = "bandit-investigate-claim-v3";
pub const AGENT: &str = "bandit-claim-investigator-v3";
const AGENT_JSON: &str = include_str!("../elastic/agents/bandit-claim-investigator.json");
const INSTRUCTIONS: &str = include_str!("../elastic/agents/bandit-claim-investigator.instructions.md");
const WORKFLOW_YAML: &str = include_str!("../elastic/workflows/bandit-investigate-claim.yaml");

impl Kibana {
    pub async fn ensure_investigator(&self) -> Result<()> {
        let mut agent: Value = serde_json::from_str(AGENT_JSON)?;
        agent["configuration"]["instructions"] = json!(INSTRUCTIONS);
        self.ensure_asset("api/agent_builder/agents", agent).await?;
        self.ensure_private_workflow(WORKFLOW, WORKFLOW_YAML).await
    }
}

/// The actual completed agent step, never a preceding parsing step.
pub fn output(execution: &Value) -> Result<&Value> {
    if execution["status"] != "completed" {
        bail!("{}", crate::reader::failure(execution));
    }
    if let Some(step) = execution["stepExecutions"].as_array().into_iter().flatten().rev()
        .find(|step| step["stepId"] == "investigate")
        && step["status"] != "completed"
    {
        bail!("investigation agent step did not complete");
    }
    reported_output(execution).context("completed investigation has no agent step output")
}

/// A failed agent step can still report usage, which belongs in its audit
/// record even though its answer must not be accepted.
pub fn reported_output(execution: &Value) -> Option<&Value> {
    if let Some(step) = execution["stepExecutions"].as_array().into_iter().flatten().rev()
        .find(|step| step["stepId"] == "investigate")
        && let Some(output) = step.get("output").filter(|value| !value.is_null())
    {
        return Some(output);
    }
    execution.get("output").filter(|value| !value.is_null())
}

pub fn answer(output: &Value) -> Result<Value> {
    let answer = output.get("structured_output").context("investigation has no structured_output")?;
    if !answer.is_object() {
        bail!("investigation structured_output is not an object");
    }
    Ok(answer.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn investigator_has_no_general_data_or_execution_capabilities() {
        let agent: Value = serde_json::from_str(AGENT_JSON).unwrap();
        assert_eq!(agent["id"], AGENT);
        assert_eq!(agent["access_control"]["access_mode"], "private");
        assert_eq!(agent["configuration"]["tools"], json!([]));
        assert_eq!(agent["configuration"]["enable_elastic_capabilities"], false);
        assert!(WORKFLOW_YAML.contains(&format!("agent-id: {AGENT}")));
        assert!(WORKFLOW_YAML.contains("create-conversation: false"));
        assert!(!WORKFLOW_YAML.contains("elasticsearch.index"));
    }

    #[test]
    fn reads_only_a_completed_agent_answer() {
        let execution = json!({"status": "completed", "stepExecutions": [
            {"stepId": "schema", "status": "completed", "output": {"type": "object"}},
            {"stepId": "investigate", "status": "completed", "output": {"structured_output": {"evidence_requests": [], "decision": {"decision": "ask_organizer"}}}}
        ]});
        assert_eq!(answer(output(&execution).unwrap()).unwrap()["decision"]["decision"], "ask_organizer");
        assert!(output(&json!({"status": "failed", "error": "agent failed"})).is_err());
        assert!(output(&json!({"status": "completed"})).is_err());
        assert!(answer(&json!({"message": "plain answer"})).is_err());
        assert!(answer(&json!({"structured_output": null})).is_err());
    }
}
