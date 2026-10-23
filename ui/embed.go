package ui

import "embed"

// Assets embeds the web frontend directly into the compiled Go binary.
//
//go:embed index.html styles.css app.js
var Assets embed.FS
