use claims_elastic::{ClaimsIndex, sections_for_kind};

#[tokio::test]
async fn probe() -> anyhow::Result<()> {
    let es = ClaimsIndex::from_env()?;
    let show = |label: &str, v: &[claims_elastic::ClauseHit]| {
        eprintln!("{label}:");
        for c in v { eprintln!("  {:.4} {} {} {} p{}", c.score, c.clause_id, c.policy, c.section, c.page); }
    };
    let q = "Theft in zone Sponsor row at 21:10: venue or sponsor property taken; staff note within 4 minutes; loss $1,199.00 logged by staff; staff named an attendee.";
    show("theft, venue + attendeehash", &es.search_clauses(q, None, Some("attendeehash"), sections_for_kind("theft"), 5).await?);
    show("theft, venue only, venuehash", &es.search_clauses(q, Some("venuehash"), None, &[], 5).await?);
    let b = "An attendee's own things lost, stolen or broken in zone Hacking floor at 02:30: personal property of a guest; no staff note; value $850.00 logged by staff; no attendee named.";
    show("belongings, venue + attendeehash", &es.search_clauses(b, None, Some("attendeehash"), sections_for_kind("belongings"), 5).await?);
    show("attendee only", &es.search_policy_clauses("theft of my phone", "attendee", Some("attendeehash"), &[], 5).await?);
    eprintln!("read: {:?}", es.read_clause("venuehash-c2").await?);
    eprintln!("read missing: {:?}", es.read_clause("nope-c1").await?);
    Ok(())
}
