# Pre-tagged photo sharing on Meta platforms

## Answer

Without asking attendees to sign in, nothing can post with tags already on the photo. The closest path is one tap on the recap page. That tap copies a caption with the friends' @mentions and opens the phone's share sheet with the photo. The attendee picks Instagram, pastes the caption and posts. The @mentions in a posted caption become real links and notify each friend. Photo tags (Instagram's "Tag people") stay manual. The only way to put them on is the API, and that needs the attendee's Instagram sign-in.

## What each platform allows

| Platform | Server posts for the user | Tags people | Share link or share sheet from a web page |
|---|---|---|---|
| Instagram | Yes: Instagram API with Instagram Login, scope `instagram_business_content_publish`. The posting account must be professional (Creator is free and takes a minute to switch on in settings). No Facebook Page needed. | Yes: `user_tags` puts real photo tags (username plus x/y) on the image, for public accounts only. Captions also take up to 20 @mentions, which notify. | No web intent exists. The phone share sheet hands Instagram the image, but Instagram ignores the caption. |
| Threads | Yes: Threads API, scope `threads_content_publish`, any Threads account. | @mentions in the post text count as tags. | `threads.com/intent/post?text=…&url=…` prefills text and a link, with no image. |
| Facebook | No: publishing to personal profiles was removed in 2018. | No | The share dialog takes a URL only, and Meta's policy forbids prefilling the post text. |

## Happy path (no sign-in, phone)

1. The email link opens the attendee's recap on their phone. Each confirmed photo shows a caption: Claude's one-line caption for that moment ([Anthropic-Agent](../system-design/Anthropic-Agent.md) `summary_story`), followed by "with @a @b @c". The handles come from the other confirmed people in the photo who are accepted connections and have an Instagram `social_handle` with `share_mode` `on_connect`. This is the rule [Social](../system-design/Social.md) already sets: friends get mentioned and strangers stay blank. `bandit-api` appends the handles after Claude writes the line, so Claude never sees a handle.
2. The page fetches the photo as a JPEG `File` as soon as it loads. Safari only opens the share sheet straight from a tap, and fetching after the tap breaks that.
3. One "Share to Instagram" tap runs `navigator.clipboard.writeText(caption)` and then `navigator.share({ files: [photo] })` in the same handler. The button shows "Caption copied, paste it in Instagram".
4. What the attendee does by hand: picks Instagram in the share sheet, picks Feed, long-presses the caption field and pastes, then taps Share. That's four taps, with no typing and no sign-in.

Limits that shape it:
- Instagram ignores any text passed through the share sheet, so the caption has to go through the clipboard.
- Instagram allows at most 20 @mentions in a caption. Photos have fewer people than that.
- The path is built for phones (iOS Safari and Android Chrome), which is where the email link opens. Desktop share sheets don't list Instagram.

## Fit with the Meta track

The track is "Meta/Facebook: Bringing People Closer Together with AI". Devpost lists no required technology and no criteria beyond the general ones. Sharing to Instagram fits it best: one event photo with the friends in it @mentioned connects them on the network the README pitch is built on ("forgot to get their Insta"), and Claude writes the caption. No Meta app or App Review is needed for this path. Threads and Facebook add nothing here.

## Sources

- [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
- [Instagram Platform overview: access levels](https://developers.facebook.com/docs/instagram-platform/overview)
- [IG User Media reference: `user_tags`, `image_url`, caption limits](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md)
- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- [Threads posts](https://developers.facebook.com/documentation/threads/posts), [Threads mentions](https://developers.facebook.com/documentation/threads/threads-mentions.md), [Threads web intents](https://developers.facebook.com/documentation/threads/threads-web-intents.md)
- [Facebook timeline publishing removed (2018)](https://wptavern.com/facebook-shuts-down-api-for-publishing-to-user-timelines-impacts-jetpacks-publicize-feature), [Facebook prefill policy](https://help.socialhp.com/en/frequently-asked-questions/why-don-t-you-pre-fill-personal-facebook-posts)
- [Instagram ignores prefilled captions](https://ionicframework.com/docs/v3/native/instagram)
- [Web Share API with files (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [CalHacks 13.0 prizes](https://cal-hacks-13-0.devpost.com/)
