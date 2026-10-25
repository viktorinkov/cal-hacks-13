//! Every clause of the policies BandIt reads, one document each in
//! `<prefix>-policy-clauses` (`bandit-policy-clauses` live), so a claim can be
//! matched against the contract's own words. Only clauses code found word for
//! word on their page are written here.

use anyhow::{Context, Result};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ClaimsIndex, INFERENCE_ID, check_id};

/// One clause of a checked policy.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PolicyClause {
    /// `<document_hash>-c<n>`, n the clause's 1-based position among the checked clauses.
    pub clause_id: String,
    /// `venue` or `attendee`.
    pub policy: String,
    /// SHA-256 of the policy PDF.
    pub document_hash: String,
    /// A `bandit_insurance::policy::SECTIONS` name, such as `exclusions`.
    pub section: String,
    /// 1-based page the clause is printed on.
    pub page: u32,
    pub text: String,
}

impl ClaimsIndex {
    /// `<prefix>-policy-clauses`.
    pub fn clauses_index(&self) -> String {
        format!("{}-policy-clauses", self.prefix)
    }

    /// Creates the clause index if it is missing. An existing index gets the
    /// current mapping, and its clauses written before `text.words` was mapped
    /// are written again so the keyword search finds them too.
    pub async fn ensure_clauses_index(&self) -> Result<()> {
        if !self.ensure_index(&self.clauses_index(), json!({ "mappings": clause_mappings() })).await? {
            let body = json!({ "query": { "bool": { "must_not": { "exists": { "field": "text.words" } } } } });
            let path = format!("{}/_update_by_query?conflicts=proceed&refresh=true", self.clauses_index());
            self.call(Method::POST, &path, Some(body)).await?;
        }
        Ok(())
    }

    /// Writes clauses under their `clause_id`, so writing a document's clauses again overwrites them.
    pub async fn index_policy_clauses(&self, clauses: &[PolicyClause]) -> Result<()> {
        if clauses.is_empty() {
            return Ok(());
        }
        let index = self.clauses_index();
        let docs = clauses
            .iter()
            .map(|c| {
                check_id(&c.clause_id)?;
                Ok((index.clone(), c.clause_id.clone(), serde_json::to_value(c)?))
            })
            .collect::<Result<Vec<_>>>()?;
        self.bulk("refresh=wait_for", docs).await.context("indexing policy clauses")
    }

    /// Deletes every clause of one document, before its clauses are written again. Returns how many there were.
    pub async fn delete_policy_clauses(&self, document_hash: &str) -> Result<u64> {
        let body = json!({ "query": { "term": { "document_hash": document_hash } } });
        let path = format!("{}/_delete_by_query?refresh=true", self.clauses_index());
        let v = self.call(Method::POST, &path, Some(body)).await?;
        Ok(v["deleted"].as_u64().unwrap_or(0))
    }
}

fn clause_mappings() -> Value {
    let kw = json!({ "type": "keyword" });
    json!({
        "dynamic": false,
        "properties": {
            "clause_id": kw, "policy": kw, "document_hash": kw, "section": kw,
            "page": { "type": "integer" },
            // `words` is the same text for the keyword half of the hybrid clause search.
            "text": { "type": "semantic_text", "inference_id": INFERENCE_ID, "fields": { "words": { "type": "text", "analyzer": "english" } } }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clause_serializes_with_mapping_names() {
        let c = PolicyClause {
            clause_id: "ab12-c1".into(),
            policy: "venue".into(),
            document_hash: "ab12".into(),
            section: "exclusions".into(),
            page: 2,
            text: "This insurance does not apply to bodily injury to any employee.".into(),
        };
        let v = serde_json::to_value(&c).unwrap();
        let mapped = clause_mappings();
        for key in v.as_object().unwrap().keys() {
            assert!(mapped["properties"].get(key).is_some(), "{key} is not mapped");
        }
        assert_eq!(mapped["properties"]["text"]["inference_id"], INFERENCE_ID);
        assert_eq!(mapped["properties"]["text"]["fields"]["words"]["type"], "text");
        assert_eq!(serde_json::from_value::<PolicyClause>(v).unwrap(), c);
    }
}
