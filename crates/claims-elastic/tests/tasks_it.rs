//! Opt-in check of the deployed bounded text workflow with public test data.

use std::time::Duration;
use claims_elastic::{Kibana, tasks};
use serde_json::json;

#[tokio::test]
async fn bounded_task_round_trip() -> anyhow::Result<()> {
    if std::env::var("ELASTIC_TASKS_IT").as_deref() != Ok("1") {
        eprintln!("skipped: set ELASTIC_TASKS_IT=1 to run against Kibana");
        return Ok(());
    }
    if let Ok(path) = std::env::var("BANDIT_ENV_FILE") {
        dotenvy::from_path(path)?;
    } else {
        dotenvy::dotenv().ok();
    }
    let kibana = Kibana::new(&std::env::var("KIBANA_URL")?, &std::env::var("KIBANA_API_KEY")?)?;
    kibana.ensure_tasks().await?;
    let task = tasks::TaskRequest {
        task: "contract_check".into(), system: "Use only facts from the supplied input.".into(),
        prompt: "The event has exactly three exits. Return their count.".into(),
        schema: json!({"type": "object", "properties": {"exits": {"type": "integer"}}, "required": ["exits"], "additionalProperties": false}),
    };
    let id = kibana.run_workflow(tasks::WORKFLOW, task.inputs()).await?;
    let execution = kibana.wait_for(&id, Duration::from_secs(2), Duration::from_secs(120)).await?;
    let output = tasks::output(&execution)?;
    assert_eq!(tasks::answer(output)?, json!({"exits": 3}));
    let metadata = tasks::metadata(output);
    eprintln!("execution {id}, reported model/connector {}, reported tokens {:?}", tasks::model(&metadata), tasks::tokens(&metadata));
    Ok(())
}
