//! Proposing a payment rule from the organizer's approvals: the Elastic ES|QL
//! tool `bandit.claim_precedents`, which counts the offered claims' copies in
//! `<prefix>-claims`, the Elastic Agent Builder agent `bandit-rule-proposer`
//! and the Elastic Workflow `bandit-propose-rule`, which saves the answer to
//! `<prefix>-rule-proposals`. Installed from `elastic/` and run by the worker's
//! `rule_proposal` job.

use anyhow::{Context, Result, bail};
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::reader::Kibana;
use crate::{ClaimsIndex, check_id, hits, short};

pub const WORKFLOW: &str = "bandit-propose-rule";
pub const AGENT: &str = "bandit-rule-proposer";
pub const TOOL: &str = "bandit.claim_precedents";

pub(crate) const TOOL_JSON: &str = include_str!("../elastic/tools/bandit.claim_precedents.json");
const AGENT_JSON: &str = include_str!("../elastic/agents/bandit-rule-proposer.json");
const AGENT_INSTRUCTIONS: &str = include_str!("../elastic/agents/bandit-rule-proposer.instructions.md");
const WORKFLOW_YAML: &str = include_str!("../elastic/workflows/bandit-propose-rule.yaml");

/// A claim's newest copy in the claims index.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ClaimCopy {
    pub doc_id: String,
    pub claim_id: i64,
    pub pack_version: i32,
    /// Empty until the claim's decision is recorded.
    pub outcome: String,
    pub payout_cents: i64,
}

impl Kibana {
    /// Creates or updates the proposer's tool, agent and workflow.
    pub async fn ensure_proposer(&self) -> Result<()> {
        self.ensure_asset("api/agent_builder/tools", serde_json::from_str(TOOL_JSON)?).await?;
        self.ensure_asset("api/agent_builder/agents", agent()?).await?;
        self.ensure_workflow(WORKFLOW, WORKFLOW_YAML).await
    }
}

impl ClaimsIndex {
    /// `<prefix>-rule-proposals`, the workflow's answer, one document per try of a proposal.
    pub fn proposals_index(&self) -> String {
        format!("{}-rule-proposals", self.prefix)
    }

    /// Creates the answer index if it is missing.
    pub async fn ensure_proposals_index(&self) -> Result<()> {
        self.ensure_index(&self.proposals_index(), json!({ "mappings": proposals_mappings() })).await?;
        Ok(())
    }

    /// The claim's newest copy, by the time the pipeline wrote it. A copy left from an earlier run
    /// with the same claim id is older, so it never wins.
    pub async fn newest_copy(&self, claim_id: i64) -> Result<Option<ClaimCopy>> {
        let query = json!({
            "size": 1,
            "query": { "term": { "claim_id": claim_id } },
            "sort": [{ "indexed_at": { "order": "desc", "unmapped_type": "date" } }, { "pack_version": "desc" }],
            "_source": ["doc_id", "claim_id", "pack_version", "outcome", "payout_cents"]
        });
        let v = self.call(Method::POST, &format!("{}/_search", self.index), Some(query)).await?;
        hits(&v).next().map(|h| serde_json::from_value(h["_source"].clone()).context("a claim copy has the wrong shape")).transpose()
    }

    /// The workflow's answer saved under `key`.
    pub async fn rule_answer(&self, key: &str) -> Result<Value> {
        check_id(key)?;
        let v = self.call(Method::GET, &format!("{}/_doc/{key}", self.proposals_index()), None).await?;
        if v["found"] != true {
            bail!("{} has no answer {key}", self.proposals_index());
        }
        Ok(v["_source"].clone())
    }

    /// Deletes an answer left under `key` by an earlier run, so only this run's answer is read back.
    pub async fn delete_rule_answer(&self, key: &str) -> Result<()> {
        check_id(key)?;
        let (status, v) = self.send(self.req(Method::DELETE, &format!("{}/_doc/{key}?refresh=wait_for", self.proposals_index()))).await?;
        match status {
            s if s.is_success() || s == StatusCode::NOT_FOUND => Ok(()),
            s => bail!("DELETE {key} returned {s}: {}", short(&v)),
        }
    }

    /// Runs the tool's own query, as the agent calls it.
    pub async fn claim_precedents(&self, doc_ids: &[String]) -> Result<Value> {
        let tool: Value = serde_json::from_str(TOOL_JSON)?;
        let body = json!({
            "query": tool["configuration"]["query"],
            "params": [{ "claims_index": self.index }, { "doc_ids": doc_ids.join(",") }]
        });
        self.call(Method::POST, "_query", Some(body)).await
    }
}

/// The agent with its instructions.
fn agent() -> Result<Value> {
    let mut body: Value = serde_json::from_str(AGENT_JSON)?;
    body["configuration"]["instructions"] = json!(AGENT_INSTRUCTIONS);
    Ok(body)
}

fn proposals_mappings() -> Value {
    let kw = json!({ "type": "keyword" });
    let stored = json!({ "type": "object", "enabled": false });
    json!({
        "dynamic": false,
        "properties": { "proposal_key": kw, "model": kw, "usage": stored, "answer": stored }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assets_parse_and_agree() {
        let tool: Value = serde_json::from_str(TOOL_JSON).unwrap();
        assert_eq!(tool["id"], TOOL);
        let query = tool["configuration"]["query"].as_str().unwrap();
        assert!(query.starts_with("FROM bandit*-claims METADATA _index | WHERE _index == ?claims_index"), "{query}");
        for p in ["claims_index", "doc_ids"] {
            assert!(query.contains(&format!("?{p}")) && tool["configuration"]["params"].get(p).is_some(), "{p}");
        }
        let a = agent().unwrap();
        assert_eq!((a["id"].as_str(), a["configuration"]["tools"][0]["tool_ids"][0].as_str()), (Some(AGENT), Some(TOOL)));
        assert_eq!(a["configuration"]["enable_elastic_capabilities"], false);
        assert!(a["configuration"]["instructions"].as_str().unwrap().contains("you never approve it"));
        assert!(WORKFLOW_YAML.contains(&format!("name: {WORKFLOW}")) && WORKFLOW_YAML.contains(&format!("agent-id: {AGENT}")));
        for input in ["proposal_key", "claims_index", "doc_ids", "task", "schema", "proposals_index"] {
            assert!(WORKFLOW_YAML.contains(&format!("- name: {input}")) && WORKFLOW_YAML.contains(&format!("inputs.{input}")), "{input}");
        }
    }

    #[test]
    fn the_answer_is_stored_not_indexed() {
        let m = proposals_mappings();
        assert_eq!(m["properties"]["answer"]["enabled"], false);
        assert_eq!(m["dynamic"], false);
    }
}
