# Third-Party Notices

Third-party software, documents, fonts, images, scans, and other materials retain their original
copyrights and license terms. No project license overrides those terms.

## Authoritative inventory

`data/asset-ledger.json` is the authoritative per-asset provenance and rights inventory. A public
asset must have a ledger entry that records, at minimum:

- its source and creator when known;
- its copyright or public-domain status and applicable license;
- required attribution;
- transformations made for the website;
- a checksum connecting the published derivative to the reviewed file; and
- its repository or deployed path.

Do not infer permission from a file's age, availability online, inclusion in a local reference
folder, or presence in a previous build. Material with unknown or incompatible rights must remain
unpublished until reviewed.

## Software dependencies

Dependencies installed from `package-lock.json` are governed by their respective licenses and
notices. They are not relicensed under this project's MIT License. Automated dependency inventories
or software bills of materials may be generated from the lockfile for releases.

The local bootstrap downloads an official Node.js binary but does not commit or redistribute it.
Node.js retains its own license and bundled third-party notices.

## IBM Plex

The webfont files under `public/fonts/` are derived from **IBM Plex**, distributed under the SIL Open
Font License 1.1 (`OFL-1.1`). The reviewed upstream source is the
[`IBM/plex`](https://github.com/IBM/plex) repository at commit
`bf260093582f04622aacc1e9f9ca604d7ccd0c42`.

IBM Plex remains copyright its respective authors and is not relicensed under this project's MIT or
creative-content licenses. Retain the OFL license notice with redistributed font files, and do not
use a Reserved Font Name except as permitted by the OFL.

## Local reference material

`/_IgnoreThis/` is excluded from Git and is not covered by this notice as distributed project
content. External downloads and research references stored there must not be copied into the public
repository until their rights and intended use are documented in the asset ledger.
