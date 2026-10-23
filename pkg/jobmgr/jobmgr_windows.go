//go:build windows

package jobmgr

import (
	"syscall"
	"unsafe"
)

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	createJobObjectW      = kernel32.NewProc("CreateJobObjectW")
	setInformationJobObject = kernel32.NewProc("SetInformationJobObject")
	assignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	closeHandle           = kernel32.NewProc("CloseHandle")
)

const (
	JobObjectExtendedLimitInformation = 9
	JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
)

type IO_COUNTERS struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type JOBOBJECT_BASIC_LIMIT_INFORMATION struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type JOBOBJECT_EXTENDED_LIMIT_INFORMATION struct {
	BasicLimitInformation JOBOBJECT_BASIC_LIMIT_INFORMATION
	IoInfo                IO_COUNTERS
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// Job represents a Windows Job Object that automatically terminates all child
// processes if the parent process exits or crashes.
type Job struct {
	handle syscall.Handle
}

// New creates a new Windows Job Object with KILL_ON_JOB_CLOSE enabled.
func New() (*Job, error) {
	h, _, err := createJobObjectW.Call(0, 0)
	if h == 0 {
		return nil, err
	}

	info := JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

	ret, _, err := setInformationJobObject.Call(
		h,
		JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uintptr(unsafe.Sizeof(info)),
	)
	if ret == 0 {
		closeHandle.Call(h)
		return nil, err
	}

	return &Job{handle: syscall.Handle(h)}, nil
}

// Assign assigns a process handle to this job object.
func (j *Job) Assign(processHandle uintptr) error {
	ret, _, err := assignProcessToJobObject.Call(uintptr(j.handle), processHandle)
	if ret == 0 {
		return err
	}
	return nil
}

// Close closes the job handle, terminating all assigned child processes.
func (j *Job) Close() error {
	if j.handle != 0 {
		closeHandle.Call(uintptr(j.handle))
		j.handle = 0
	}
	return nil
}
