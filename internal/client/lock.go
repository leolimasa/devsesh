package client

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"syscall"
)

// AcquireWatcherLock takes an exclusive, non-blocking advisory lock scoped to a
// tmux session name, guaranteeing at most one live watcher per session. On
// success it returns the held lock file (whose Close releases the lock) and
// ok=true; ok=false means another watcher already holds it and the caller should
// bow out. The lock lives on the open file description, so the kernel releases it
// automatically when the watcher process exits -- including a crash -- which is
// exactly the liveness signal `devsesh start` needs to decide whether to respawn
// a watcher for an already-running tmux session.
func AcquireWatcherLock(sessionsDir, sessionName string) (*os.File, bool, error) {
	f, err := os.OpenFile(watcherLockPath(sessionsDir, sessionName), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, false, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if err == syscall.EWOULDBLOCK {
			return nil, false, nil
		}
		return nil, false, err
	}
	return f, true, nil
}

// watcherLockPath derives a stable, collision-resistant lock path from the tmux
// session name. Hashing sidesteps having to sanitize names that may contain
// characters that are awkward in a filename.
func watcherLockPath(sessionsDir, sessionName string) string {
	sum := sha256.Sum256([]byte(sessionName))
	return filepath.Join(sessionsDir, "watcher-"+hex.EncodeToString(sum[:8])+".lock")
}
