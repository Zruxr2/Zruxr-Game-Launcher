# Security

If you find a security issue (for example a way for the UI to run or read arbitrary files), please report it privately through GitHub's **Security → Report a vulnerability** option on this repository rather than opening a public issue.

Zruxr only reads folder and file names when scanning, stores sign-in sessions encrypted with the OS credential store, and never exposes tokens to the renderer.
