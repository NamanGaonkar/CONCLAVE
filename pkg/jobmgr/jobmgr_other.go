//go:build !windows

package jobmgr

type Job struct{}

func New() (*Job, error) {
	return &Job{}, nil
}

func (j *Job) Assign(processHandle uintptr) error {
	return nil
}

func (j *Job) Close() error {
	return nil
}
