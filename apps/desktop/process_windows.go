package main

import (
	"os/exec"
	"syscall"
)

func hideConsole(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	// CREATE_NO_WINDOW prevents console executables such as node.exe from
	// opening a console window when launched by the GUI. Standard pipes still work.
	cmd.SysProcAttr.CreationFlags |= 0x08000000
}
