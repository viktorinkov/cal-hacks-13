# Independent merchandise visual review

Approved for the Devpost and canonical board on 2026-10-25 after inspecting the native PNG and editable scene.

The visual clearly connects a tagged event photo and booth visits to a prepared catalog design with a short printed line. The attendee previews it, chooses a size, adds an address and buys. Direct checks of `origin/vik-e2e` confirm photo-tag eligibility (`spacetimedb/server/src/merch/mod.rs:532–615`), product preferences and short lines (`crates/bandit-workers/src/shop.rs:23–37`), browser composition (`web/src/recap.ts:311–355`) and explicit checkout (`web/src/recap.ts:381–416`).

The first render had lower legs outside the illustrated photo bounds. The revised render keeps those shapes within the image area, so they no longer overlap the catalog lettering. The final layout is readable, has no green replacement field and contains no app screenshots. It does not claim live image generation, completed payment or physical dispatch. The photo is visibly an illustration and the footer identifies that status.

The editable scene contains 57 elements, one frame and three embedded original assets, with unique element IDs. No separate online board was created by this review.

Approved title: **Your photo on your merch**.

Approved caption: “Band1t pairs a photo tagged to you with a prepared booth design and a short printed line. You preview it before choosing a size, adding delivery details and buying.”

Placement: **What it does → Your recap → Shopping**, next to the existing product screenshot. The diagram explains where the product image comes from; the screenshot shows the current shopping interface.
