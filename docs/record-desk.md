# TIRN Filing Workstation

The Filing Workstation is a local authoring tool for completing the fifteen approved Trinity form
templates and preparing static report records. It is not part of the deployed website and does not
provide a multi-user inbox.

## Start the workstation

Create a content branch before preparing a publishable record, then run:

```powershell
. .\scripts\bootstrap.ps1
.\scripts\run-local.ps1 record-desk
```

The service binds only to `127.0.0.1`. Use the local address printed in the terminal. Closing the
terminal stops the workstation.

## Draft and disclosure policy

Drafts are written only beneath the ignored `.authoring/` directory. A draft may contain material
that is not ready for publication; a public record may not.

Each response must be assigned one disclosure state:

- `open` publishes and displays the response normally;
- `authorize` publishes the response for a browser-local theatrical reveal and therefore requires
  confirmation that it is safe for a public repository; or
- `withheld` publishes only a redaction label or extent and removes the response value entirely.

Authorization presentation is not confidentiality. Never mark a real password, personal record,
private source, or other secret as `authorize`.

## Publish a prepared record

The workstation can export a `.tirn-draft.json` package for review or resumption. To stage a reviewed
package from the command line:

```powershell
.\scripts\run-local.ps1 record-desk:import -- path\to\record.tirn-draft.json
```

The importer refuses `main`, rejects unknown fields and unsafe paths, prevents record-ID collisions,
and writes deterministic public JSON only. It never commits, pushes, merges, or deploys.

Review the resulting diff, then run:

```powershell
.\scripts\run-local.ps1 record-desk:validate
.\scripts\run-local.ps1 validate:submissions
.\scripts\run-local.ps1 validate
```

Publication follows the ordinary pull-request workflow. Cloudflare deploys only after the reviewed
change reaches protected `main`.

## Attachments

The first workstation release does not publish binary attachments. Add future PDFs, DOCX files, or
images only through the existing metadata-scrubbing, ownership, licensing, checksum, and asset-ledger
workflow.
