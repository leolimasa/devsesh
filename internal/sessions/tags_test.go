package sessions

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/leolimasa/devsesh/internal/ctxutil"
	"github.com/leolimasa/devsesh/internal/db"
)

func TestNormalizeTags(t *testing.T) {
	ok := []struct {
		name string
		in   []string
		want []string
	}{
		{"empty list", []string{}, []string{}},
		{"trims spaces", []string{"  work ", "home"}, []string{"work", "home"}},
		{"drops duplicates ignoring case, keeps first spelling", []string{"Work", "work", "WORK", "home"}, []string{"Work", "home"}},
		{"keeps order", []string{"b", "a", "c"}, []string{"b", "a", "c"}},
		{"allows emoji and spaces inside", []string{"🔥", "🚀 launch", "on call"}, []string{"🔥", "🚀 launch", "on call"}},
		{"32 emoji is within the limit (counts characters, not bytes)", []string{strings.Repeat("🔥", 32)}, []string{strings.Repeat("🔥", 32)}},
	}
	for _, c := range ok {
		t.Run(c.name, func(t *testing.T) {
			got, err := NormalizeTags(c.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %q, want %q", got, c.want)
			}
		})
	}

	twentyOne := make([]string, 21)
	for i := range twentyOne {
		twentyOne[i] = string(rune('a' + i))
	}
	bad := []struct {
		name string
		in   []string
	}{
		{"empty tag", []string{"ok", ""}},
		{"whitespace-only tag", []string{"   "}},
		{"comma", []string{"a,b"}},
		{"newline", []string{"a\nb"}},
		{"too long", []string{strings.Repeat("x", 33)}},
		{"too many", twentyOne},
	}
	for _, c := range bad {
		t.Run("rejects "+c.name, func(t *testing.T) {
			if _, err := NormalizeTags(c.in); err == nil {
				t.Errorf("expected an error for %q", c.in)
			}
		})
	}
}

func tagsReq(body string, session *db.Session) *http.Request {
	req := httptest.NewRequest(http.MethodPut, "/api/v1/sessions/s1/tags", strings.NewReader(body))
	ctx := context.WithValue(req.Context(), ctxutil.ContextKeyUserID, int64(1))
	if session != nil {
		ctx = context.WithValue(ctx, ctxutil.ContextKeySession, session)
	}
	return req.WithContext(ctx)
}

func newTaggedSession(t *testing.T, dbConn *sql.DB) *db.Session {
	t.Helper()
	now := time.Now()
	if err := db.CreateSession(dbConn, db.Session{ID: "s1", UserID: 1, HostID: 1, Name: "one", StartedAt: now}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	s, err := db.GetSession(dbConn, "s1")
	if err != nil || s == nil {
		t.Fatalf("get session: %v", err)
	}
	return s
}

func TestTagsHandler(t *testing.T) {
	t.Run("stores normalized tags, returns them and broadcasts a tags event", func(t *testing.T) {
		dbConn := setupTestDB(t)
		session := newTaggedSession(t, dbConn)
		hub := NewHub()
		send := make(chan []byte, 8)
		hub.clients[1] = map[*client]bool{{send: send, userID: 1}: true}

		w := httptest.NewRecorder()
		TagsHandler(dbConn, hub)(w, tagsReq(`{"tags":[" Work ","work","🔥"]}`, session))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct{ Tags []string }
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		want := []string{"Work", "🔥"}
		if !reflect.DeepEqual(resp.Tags, want) {
			t.Errorf("response tags = %q, want %q", resp.Tags, want)
		}

		stored, _ := db.GetSession(dbConn, "s1")
		if !reflect.DeepEqual(stored.Tags, want) {
			t.Errorf("stored tags = %q, want %q", stored.Tags, want)
		}

		select {
		case msg := <-send:
			var u SessionUpdate
			if err := json.Unmarshal(msg, &u); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if u.Event != "tags" || u.SessionID != "s1" || !reflect.DeepEqual(u.Session.Tags, want) {
				t.Errorf("unexpected broadcast: %+v", u)
			}
		case <-time.After(time.Second):
			t.Fatal("timeout waiting for tags broadcast")
		}
	})

	t.Run("an empty list clears the tags", func(t *testing.T) {
		dbConn := setupTestDB(t)
		session := newTaggedSession(t, dbConn)
		hub := NewHub()
		TagsHandler(dbConn, hub)(httptest.NewRecorder(), tagsReq(`{"tags":["a"]}`, session))
		w := httptest.NewRecorder()
		TagsHandler(dbConn, hub)(w, tagsReq(`{"tags":[]}`, session))
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		stored, _ := db.GetSession(dbConn, "s1")
		if len(stored.Tags) != 0 {
			t.Errorf("expected no tags, got %q", stored.Tags)
		}
	})

	t.Run("invalid input is a 400 and changes nothing", func(t *testing.T) {
		dbConn := setupTestDB(t)
		session := newTaggedSession(t, dbConn)
		hub := NewHub()
		TagsHandler(dbConn, hub)(httptest.NewRecorder(), tagsReq(`{"tags":["keep"]}`, session))
		for _, body := range []string{`{"tags":["a,b"]}`, `{"tags":[""]}`, `{"tags":null}`, `{}`, `not json`} {
			w := httptest.NewRecorder()
			TagsHandler(dbConn, hub)(w, tagsReq(body, session))
			if w.Code != http.StatusBadRequest {
				t.Errorf("body %s: expected 400, got %d", body, w.Code)
			}
		}
		stored, _ := db.GetSession(dbConn, "s1")
		if !reflect.DeepEqual(stored.Tags, []string{"keep"}) {
			t.Errorf("tags changed by a rejected request: %q", stored.Tags)
		}
	})

	t.Run("missing session in context is not found", func(t *testing.T) {
		dbConn := setupTestDB(t)
		w := httptest.NewRecorder()
		TagsHandler(dbConn, NewHub())(w, tagsReq(`{"tags":[]}`, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestSessionsAlwaysListTags(t *testing.T) {
	dbConn := setupTestDB(t)
	newTaggedSession(t, dbConn)

	list, err := db.GetSessionsByUserID(dbConn, 1)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v (%d rows)", err, len(list))
	}
	if list[0].Tags == nil {
		t.Fatal("Tags must be an empty list, not nil, so the API never returns null")
	}
	raw, _ := json.Marshal(list[0])
	if !bytes.Contains(raw, []byte(`"tags":[]`)) {
		t.Errorf("expected \"tags\":[] in %s", raw)
	}
}

func TestTagsSurviveSessionRestart(t *testing.T) {
	dbConn := setupTestDB(t)
	newTaggedSession(t, dbConn)
	if err := db.UpdateSessionTags(dbConn, "s1", []string{"keep", "🔥"}); err != nil {
		t.Fatalf("update tags: %v", err)
	}

	// `devsesh start` for a still-running session re-sends the start request.
	hub := NewHub()
	send := make(chan []byte, 8)
	hub.clients[1] = map[*client]bool{{send: send, userID: 1}: true}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/s1/start",
		strings.NewReader(`{"name":"one","start_time":"2026-01-01T00:00:00Z"}`))
	ctx := context.WithValue(context.WithValue(req.Context(), ctxutil.ContextKeyUserID, int64(1)), ctxutil.ContextKeyHostID, int64(1))
	req = req.WithContext(ctx)
	req.SetPathValue("session_id", "s1")
	w := httptest.NewRecorder()
	StartHandler(dbConn, hub)(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}

	want := []string{"keep", "🔥"}
	stored, _ := db.GetSession(dbConn, "s1")
	if !reflect.DeepEqual(stored.Tags, want) {
		t.Errorf("tags after restart = %q, want %q", stored.Tags, want)
	}

	// The browser replaces its copy of the session with this broadcast, so it
	// must carry the tags or a restart would blank them on screen.
	select {
	case msg := <-send:
		var u SessionUpdate
		if err := json.Unmarshal(msg, &u); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if u.Event != "start" || !reflect.DeepEqual(u.Session.Tags, want) {
			t.Errorf("start broadcast tags = %q (event %s), want %q", u.Session.Tags, u.Event, want)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for start broadcast")
	}
}
