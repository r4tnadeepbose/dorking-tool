package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Module struct {
	ID string `json:"id"`
}

type QueryDef struct {
	ID          string   `json:"id"`
	Label       string   `json:"label"`
	Category    string   `json:"category"`
	Module      string   `json:"module"`
	Priority    string   `json:"priority"`
	Template    string   `json:"template"`
	Description string   `json:"description"`
	Explanation string   `json:"explanation"`
	Operators   []string `json:"operators"`
	EnginesNote string   `json:"enginesNote"`
	Global      bool     `json:"global"`
}

type Data struct {
	Modules []Module   `json:"MODULES"`
	Queries []QueryDef `json:"QUERIES"`
}

type Input struct {
	Target  string     `json:"target"`
	Scope   string     `json:"scope"`
	Modules []string   `json:"modules"`
	Queries []QueryDef `json:"queries"`
}

type TargetInfo struct {
	Ok         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
	Input      string `json:"input,omitempty"`
	Normalized string `json:"normalized,omitempty"`
	Scope      string `json:"scope,omitempty"`
	ScopeLabel string `json:"scopeLabel,omitempty"`
	Display    string `json:"display,omitempty"`
}

type OutQuery struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Category    string   `json:"category"`
	Module      string   `json:"module"`
	Priority    string   `json:"priority"`
	Query       string   `json:"query"`
	Description string   `json:"description"`
	Explanation string   `json:"explanation"`
	Operators   []string `json:"operators"`
	EnginesNote string   `json:"enginesNote"`
	Global      bool     `json:"global"`
	Source      string   `json:"source"`
	Status      string   `json:"status"`
	Saved       bool     `json:"saved"`
	Selected    bool     `json:"selected"`
	Notes       string   `json:"notes"`
	Tags        []string `json:"tags"`
}

type Output struct {
	Ok         bool       `json:"ok"`
	Error      string     `json:"error,omitempty"`
	EngineUsed string     `json:"engine_used,omitempty"`
	Target     TargetInfo `json:"target,omitempty"`
	Count      int        `json:"count,omitempty"`
	Queries    []OutQuery `json:"queries,omitempty"`
}

var domainRe = regexp.MustCompile(`^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func normalizeTarget(raw, scope string) TargetInfo {
	inp := strings.TrimSpace(raw)
	if inp == "" {
		return TargetInfo{Ok: false, Error: "Target is required."}
	}
	if regexp.MustCompile(`(?i)^\s*javascript:`).MatchString(inp) {
		return TargetInfo{Ok: false, Error: "Unsafe URL scheme is not allowed."}
	}
	s := regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`).ReplaceAllString(inp, "")
	s = regexp.MustCompile(`^[^@/]+@`).ReplaceAllString(s, "")
	for _, sep := range []string{"/", "?", "#", ":"} {
		if i := strings.Index(s, sep); i >= 0 {
			s = s[:i]
		}
	}
	s = strings.ToLower(strings.TrimSpace(s))
	if strings.Contains(s, "..") || !domainRe.MatchString(s) {
		return TargetInfo{Ok: false, Error: "Invalid domain/hostname format."}
	}
	target := s
	label := "Exact hostname"
	switch scope {
	case "root":
		target = toRoot(s)
		label = "Root domain"
	case "root_sub":
		target = toRoot(s)
		label = "Root domain and subdomains"
	case "exact":
		target = strings.TrimPrefix(s, "*.")
		label = "Exact hostname"
	case "custom":
		label = "Custom scope"
	default:
		if scope == "" {
			scope = "root"
			target = toRoot(s)
			label = "Root domain"
		}
	}
	if !domainRe.MatchString(target) {
		return TargetInfo{Ok: false, Error: "Normalized target is invalid."}
	}
	display := target
	if scope == "root_sub" {
		display = target + " (+ subdomains)"
	}
	return TargetInfo{Ok: true, Input: inp, Normalized: target, Scope: scope, ScopeLabel: label, Display: display}
}

func toRoot(h string) string {
	h = strings.TrimPrefix(h, "*.")
	parts := strings.Split(h, ".")
	if len(parts) <= 2 {
		return h
	}
	last2 := strings.Join(parts[len(parts)-2:], ".")
	multi := map[string]bool{"co.uk": true, "org.uk": true, "ac.uk": true, "gov.uk": true, "com.au": true, "net.au": true, "org.au": true, "co.jp": true, "co.nz": true, "com.br": true, "com.mx": true, "co.in": true}
	if multi[last2] && len(parts) >= 3 {
		return strings.Join(parts[len(parts)-3:], ".")
	}
	return last2
}

func normalizeQuery(q string) string {
	return strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(q, " "))
}

func validateQuery(q string) bool {
	if strings.TrimSpace(q) == "" {
		return false
	}
	if regexp.MustCompile(`\{(target|keyword|extension|subdomain|path|date_from|date_to)\}`).MatchString(q) {
		return false
	}
	if strings.Count(q, "\"")%2 != 0 {
		return false
	}
	depth := 0
	for _, c := range q {
		if c == '(' {
			depth++
		} else if c == ')' {
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	return depth == 0
}

func detectOps(query string) []string {
	ops := []string{}
	checks := []struct {
		n string
		r *regexp.Regexp
	}{
		{"site:", regexp.MustCompile(`(?i)\bsite:`)}, {"inurl:", regexp.MustCompile(`(?i)\binurl:`)}, {"allinurl:", regexp.MustCompile(`(?i)\ballinurl:`)},
		{"intitle:", regexp.MustCompile(`(?i)\bintitle:`)}, {"allintitle:", regexp.MustCompile(`(?i)\ballintitle:`)},
		{"intext:", regexp.MustCompile(`(?i)\bintext:`)}, {"allintext:", regexp.MustCompile(`(?i)\ballintext:`)},
		{"filetype:", regexp.MustCompile(`(?i)\bfiletype:`)}, {"ext:", regexp.MustCompile(`(?i)\bext:`)}, {"cache:", regexp.MustCompile(`(?i)\bcache:`)},
		{"after:", regexp.MustCompile(`(?i)\bafter:`)}, {"before:", regexp.MustCompile(`(?i)\bbefore:`)},
		{"\"", regexp.MustCompile(`"[^"]+"`)}, {"OR", regexp.MustCompile(`\bOR\b|\|`)}, {"-", regexp.MustCompile(`(?:^|\s)-\S`)}, {"()", regexp.MustCompile(`[()]`)}, {"*", regexp.MustCompile(`\*`)},
	}
	for _, c := range checks {
		if c.r.MatchString(query) {
			ops = append(ops, c.n)
		}
	}
	return ops
}

func loadData() (Data, error) {
	// try ./data.json, ../data.json
	paths := []string{"data.json", filepath.Join("..", "data.json")}
	exe, _ := os.Executable()
	if exe != "" {
		paths = append(paths, filepath.Join(filepath.Dir(exe), "..", "data.json"), filepath.Join(filepath.Dir(exe), "data.json"))
	}
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err == nil {
			var d Data
			if json.Unmarshal(b, &d) == nil {
				return d, nil
			}
		}
	}
	return Data{}, fmt.Errorf("data.json not found")
}

func rank(p string) int {
	switch p {
	case "critical":
		return 5
	case "high":
		return 4
	case "medium":
		return 3
	case "low":
		return 2
	default:
		return 1
	}
}

func main() {
	inBytes, _ := io.ReadAll(os.Stdin)
	var in Input
	_ = json.Unmarshal(inBytes, &in)
	if in.Target == "" {
		in.Target = "example.com"
	}
	if in.Scope == "" {
		in.Scope = "root"
	}
	info := normalizeTarget(in.Target, in.Scope)
	if !info.Ok {
		json.NewEncoder(os.Stdout).Encode(Output{Ok: false, Error: info.Error})
		return
	}
	defs := in.Queries
	if len(defs) == 0 {
		d, err := loadData()
		if err != nil {
			json.NewEncoder(os.Stdout).Encode(Output{Ok: false, Error: "No query definitions provided and data.json not found"})
			return
		}
		defs = d.Queries
		if len(in.Modules) == 0 {
			for _, m := range d.Modules {
				in.Modules = append(in.Modules, m.ID)
			}
		}
	}
	modset := map[string]bool{}
	for _, m := range in.Modules {
		modset[m] = true
	}
	type pair struct {
		q OutQuery
		r int
	}
	seen := map[string]pair{}
	for _, d := range defs {
		if len(modset) > 0 && !modset[d.Module] {
			continue
		}
		qs := strings.ReplaceAll(d.Template, "{target}", info.Normalized)
		if !d.Global && in.Scope == "root_sub" && normalizeQuery(d.Template) == "site:{target}" {
			qs = "(site:" + info.Normalized + " OR site:*." + info.Normalized + ")"
		}
		qs = normalizeQuery(qs)
		if !validateQuery(qs) {
			continue
		}
		key := strings.ToLower(qs)
		ops := d.Operators
		if len(ops) == 0 {
			ops = detectOps(qs)
		}
		eng := d.EnginesNote
		if eng == "" {
			eng = "Varies by engine."
		}
		pri := d.Priority
		if pri == "" {
			pri = "informational"
		}
		oq := OutQuery{
			ID: d.ID + "_go", Key: key, Label: d.Label, Category: d.Category, Module: d.Module, Priority: pri,
			Query: qs, Description: d.Description, Explanation: d.Explanation, Operators: ops,
			EnginesNote: eng, Global: d.Global, Source: "preset", Status: "Not Reviewed", Saved: false, Selected: true, Notes: "", Tags: []string{},
		}
		r := rank(pri)
		if prev, ok := seen[key]; !ok || r > prev.r {
			seen[key] = pair{q: oq, r: r}
		}
	}
	out := make([]OutQuery, 0, len(seen))
	for _, v := range seen {
		out = append(out, v.q)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Category == out[j].Category {
			return out[i].Label < out[j].Label
		}
		return out[i].Category < out[j].Category
	})
	json.NewEncoder(os.Stdout).Encode(Output{Ok: true, EngineUsed: "go", Target: info, Count: len(out), Queries: out})
}
