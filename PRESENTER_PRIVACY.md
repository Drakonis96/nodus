# Nodus Presenter Privacy Policy

Effective date: 1 October 2026. Applies to Nodus Presenter 0.2.0 for iPhone and iPad.

Nodus Presenter is the free mobile remote for PDF Presenter in Nodus Research.
The project is maintained by Jorge Pérez Burgueño. The developer does not collect
personal data from the app, operate an app account or receive your presentations.
The app has no advertising, tracking, remote analytics, purchases or subscriptions.

## Presentation data and pairing

When you pair with Nodus Research by scanning its QR code or pasting its session
link, the app connects to the computer you chose. It receives the current PDF,
slide previews, presenter notes and presentation state, and sends your presentation
commands to that computer. This includes navigation, pointers and drawing,
video playback, volume, timing and audience-screen controls.

These exchanges use an authenticated, encrypted TLS connection between the paired
devices. Mac pairing uses Apple's local/peer-to-peer networking. Windows and Linux
pairing uses the local network and verifies the computer's certificate against
the fingerprint in its QR code. No presentation content is sent to a developer
server, analytics provider, AI service or advertising network by this mobile app.

The session includes a randomly generated controller identifier used by the
paired computer; it is not a cross-app tracking identifier. Pairing credentials
are session-specific. Disconnecting clears the mobile app's in-memory pairing,
notes, previews and presentation state. Ending the presentation on the computer
invalidates that presentation's connection.

## Camera and local-network permissions

The camera is used only to recognize the pairing QR code. Camera frames are
processed on the device and are not recorded, saved or uploaded. You can instead
paste a session link without granting camera access. Local-network access lets
the app discover and communicate with the computer you pair. You can manage or
revoke these permissions in the device's Settings.

## Local storage and retention

The app stores appearance and layout preferences locally. It caches downloaded
presentation PDFs in its private cache directory to render slides and resume
downloads. Disconnecting does not immediately delete those cached files. On app
startup, presentation cache files older than seven days are removed; the operating
system may also purge cached files. Deleting the app removes its local container.
Copies of the original presentation on your computer remain under your control.

The built-in demo uses bundled example content and simulated commands. It does
not require pairing, camera access or network access.

## Your choices and contact

You choose which presentation to pair and can disconnect at any time. Protect
your devices and pairing QR code: anyone authorized by that session can receive
its presentation and control its audience screen. The developer cannot access,
correct or delete presentation data on your devices.

For support, visit [Nodus Research support](https://nodusresearch.com/faq/).
For private security or privacy concerns, use the project's
[private reporting channel](https://github.com/jorgepb96/nodus/security/advisories/new).
If you contact the project yourself, the information you send is handled by the
service you choose under that service's privacy terms. Apple separately processes
App Store and optional system diagnostic information under its own policies.

The companion desktop app has additional, optional capabilities covered by the
[Nodus Research privacy policy](PRIVACY.md). They are not mobile-app features.
Material changes to this mobile policy will be published here with a new date.

The same policy is published on the project website at
[https://nodusresearch.com/presenter/privacy/](https://nodusresearch.com/presenter/privacy/).
