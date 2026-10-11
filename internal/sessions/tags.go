package sessions

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// maxTagRunes counts characters, not bytes, so an emoji tag is not penalized.
	maxTagRunes = 32
	maxTags     = 20
)

// NormalizeTags validates a tag list from the client and returns the cleaned
// version to store: each tag trimmed, duplicates (ignoring case) dropped with
// the first spelling kept, original order preserved. Tags may be any text,
// including emoji. Commas and control characters are rejected so tags stay
// unambiguous in the UI, and so are over-long tags and too many tags.
func NormalizeTags(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, raw := range in {
		tag := strings.TrimSpace(raw)
		if tag == "" {
			return nil, errors.New("tags cannot be empty")
		}
		if utf8.RuneCountInString(tag) > maxTagRunes {
			return nil, fmt.Errorf("tag %q is longer than %d characters", tag, maxTagRunes)
		}
		for _, r := range tag {
			if r == ',' || unicode.IsControl(r) {
				return nil, fmt.Errorf("tag %q contains a comma or control character", tag)
			}
		}
		key := strings.ToLower(tag)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, tag)
	}
	if len(out) > maxTags {
		return nil, fmt.Errorf("a session can have at most %d tags", maxTags)
	}
	return out, nil
}
