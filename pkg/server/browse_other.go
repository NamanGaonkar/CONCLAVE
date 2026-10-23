//go:build !windows

package server

import "errors"

func pickFolderDialog() (string, error) {
	return "", errors.New("folder picker only supported on Windows")
}

func revealInExplorer(path string) error {
	return errors.New("reveal in explorer only supported on Windows")
}
