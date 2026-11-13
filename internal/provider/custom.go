package provider

import (
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type CustomProvider struct {
	Command    string `yaml:"command"`
	Output     string `yaml:"output"`
	ResumeArgs string `yaml:"resume_args"`
}
type customConfig struct {
	Providers map[string]CustomProvider `yaml:"providers"`
}

func CustomProviders() (map[string]CustomProvider, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(filepath.Join(home, ".dispatch", "providers.yaml"))
	if os.IsNotExist(err) {
		return map[string]CustomProvider{}, nil
	}
	if err != nil {
		return nil, err
	}
	var c customConfig
	if err = yaml.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	for name, p := range c.Providers {
		if p.Command == "" || (p.Output != "text" && p.Output != "stream-json") {
			return nil, fmt.Errorf("provider %s requires command and output text or stream-json", name)
		}
	}
	return c.Providers, nil
}
func shellQuote(s string) string {
	if runtime.GOOS == "windows" {
		return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `%`, `%%`), `"`, `""`) + `"`
	}
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}
func CustomCommand(p CustomProvider, o Options, workdir string) string {
	command := p.Command
	if o.Session != "" && p.ResumeArgs != "" {
		command += " " + p.ResumeArgs
	}
	for _, v := range [][2]string{{"{prompt}", o.Prompt}, {"{session}", o.Session}, {"{model}", o.Model}, {"{workdir}", workdir}} {
		command = strings.ReplaceAll(command, v[0], shellQuote(v[1]))
	}
	return command
}
