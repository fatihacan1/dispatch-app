package config

import (
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
)

type Config struct {
	Boss        string `yaml:"boss"`
	Theme       string `yaml:"theme"`
	WelcomeSeen bool   `yaml:"welcome_seen"`
}

func Path() string { h, _ := os.UserHomeDir(); return filepath.Join(h, ".dispatch", "config.yaml") }
func Load() Config {
	var c Config
	b, e := os.ReadFile(Path())
	if e == nil {
		_ = yaml.Unmarshal(b, &c)
	}
	return c
}
func Save(c Config) error {
	p := Path()
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		return e
	}
	b, e := yaml.Marshal(c)
	if e != nil {
		return e
	}
	return os.WriteFile(p, b, 0600)
}
