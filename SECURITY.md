# Security policy

## Supported versions

Only the latest release gets security fixes. Installed copies update themselves from GitHub Releases.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what you think the impact is.

You'll get a reply as soon as possible, and credit in the release notes if you'd like it.

## What's in scope

- Anything that lets a downloaded file, archive, source list or web page write outside its intended folder, run code, or read files it shouldn't.
- Escapes from the sandboxed host panel (pages reaching `localhost`, the local network, `file:` addresses or the launcher itself).
- Problems with how account sign-in sessions are stored or sent.

## Out of scope

- The content of third-party files or sources a person chooses to add or download. Zruxr doesn't host or vet them; scan downloads with your own antivirus.
- Windows SmartScreen warnings. The app isn't code-signed.
- Issues that need an attacker to already control the person's PC.
