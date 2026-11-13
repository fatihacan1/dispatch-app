package storage

import (
	"fmt"
	"os"
	"path/filepath"
)

// Migrate preserves existing state while changing its directory name.
func Migrate(base string) error {
	oldPath, newPath := filepath.Join(base, ".myarmy"), filepath.Join(base, ".dispatch")
	_, oldErr := os.Stat(oldPath)
	_, newErr := os.Stat(newPath)
	if oldErr != nil && !os.IsNotExist(oldErr) {
		return oldErr
	}
	if newErr != nil && !os.IsNotExist(newErr) {
		return newErr
	}
	if oldErr == nil && newErr == nil {
		return fmt.Errorf("both %s and %s exist; resolve them before starting Dispatch", oldPath, newPath)
	}
	if oldErr == nil {
		return os.Rename(oldPath, newPath)
	}
	return nil
}
