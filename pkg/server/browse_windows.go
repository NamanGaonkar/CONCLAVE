//go:build windows

package server

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32DLL = windows.NewLazySystemDLL("shell32.dll")
	ole32DLL   = windows.NewLazySystemDLL("ole32.dll")
)

type browseInfo struct {
	Owner    windows.Handle
	Display  *uint16
	Title    *uint16
	Flags    uint32
	Callback uintptr
	LParam   uintptr
	Image    int32
	Root     *uint16
}

const (
	bifReturnOnlyFsDirs = 0x00000001
	bifUseNewUI         = 0x00000040
	bifTitleBar         = 0x00000010
)

func pickFolderDialog() (string, error) {
	titlePtr, _ := windows.UTF16PtrFromString("Select CONCLAVE Project Folder")
	dlg := &browseInfo{
		Title: titlePtr,
		Flags: bifReturnOnlyFsDirs | bifUseNewUI | bifTitleBar,
	}

	proc := shell32DLL.NewProc("SHBrowseForFolderW")
	ret, _, err := proc.Call(uintptr(unsafe.Pointer(dlg)))
	if ret == 0 {
		return "", err
	}
	pidl := windows.Handle(ret)
	defer ole32DLL.NewProc("CoTaskMemFree").Call(uintptr(pidl))

	buf := make([]uint16, 512)
	proc2 := shell32DLL.NewProc("SHGetPathFromIDListW")
	ret2, _, err2 := proc2.Call(uintptr(pidl), uintptr(unsafe.Pointer(&buf[0])))
	if ret2 == 0 {
		return "", err2
	}
	return windows.UTF16ToString(buf), nil
}

func revealInExplorer(path string) error {
	return exec.Command("explorer.exe", path).Start()
}
