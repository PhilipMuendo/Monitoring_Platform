package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"solar-monitor/internal/auth"
	"solar-monitor/internal/models"
	"solar-monitor/internal/storage"
)

type createSiteRequest struct {
	Name                string   `json:"name"`
	Brand               string   `json:"brand"`
	BrandSiteID         string   `json:"brand_site_id"`
	Location            string   `json:"location"`
	Latitude            *float64 `json:"latitude"`
	Longitude           *float64 `json:"longitude"`
	CapacityKW          float64  `json:"capacity_kw"`
	InstallerAccountID  string   `json:"installer_account_id"`
}

func (d *Deps) handleCreateSite(w http.ResponseWriter, r *http.Request) {
	var req createSiteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Brand == "" || req.BrandSiteID == "" {
		writeError(w, http.StatusBadRequest, "name, brand and brand_site_id are required")
		return
	}
	brand := models.Brand(req.Brand)
	if brand != models.BrandDeye && brand != models.BrandIngecon && brand != models.BrandSosen {
		writeError(w, http.StatusBadRequest, "brand must be one of: deye, ingecon, sosen")
		return
	}

	site, err := d.Sites.Create(r.Context(), storage.CreateSiteInput{
		Name: req.Name, Brand: brand, BrandSiteID: req.BrandSiteID, Location: req.Location,
		Latitude: req.Latitude, Longitude: req.Longitude, CapacityKW: req.CapacityKW,
		InstallerAccountID: req.InstallerAccountID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create site")
		return
	}

	u, _ := auth.UserFromContext(r.Context())
	d.Audit.Log(r.Context(), u.ID, "site.create", "site", site.ID, req)

	writeJSON(w, http.StatusCreated, site)
}

type updateSiteRequest struct {
	Name       *string  `json:"name"`
	Location   *string  `json:"location"`
	Latitude   *float64 `json:"latitude"`
	Longitude  *float64 `json:"longitude"`
	CapacityKW *float64 `json:"capacity_kw"`
	IsActive   *bool    `json:"is_active"`
}

func (d *Deps) handleUpdateSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateSiteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	site, err := d.Sites.Update(r.Context(), id, storage.UpdateSiteInput{
		Name: req.Name, Location: req.Location, Latitude: req.Latitude,
		Longitude: req.Longitude, CapacityKW: req.CapacityKW, IsActive: req.IsActive,
	})
	if err != nil {
		if err == storage.ErrNotFound {
			writeError(w, http.StatusNotFound, "site not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update site")
		return
	}

	u, _ := auth.UserFromContext(r.Context())
	d.Audit.Log(r.Context(), u.ID, "site.update", "site", id, req)

	writeJSON(w, http.StatusOK, site)
}

func (d *Deps) handleDeleteSite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := d.Sites.Delete(r.Context(), id); err != nil {
		if err == storage.ErrNotFound {
			writeError(w, http.StatusNotFound, "site not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete site")
		return
	}

	u, _ := auth.UserFromContext(r.Context())
	d.Audit.Log(r.Context(), u.ID, "site.delete", "site", id, nil)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type createUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

func (d *Deps) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := d.Users.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list users")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (d *Deps) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	role := models.Role(req.Role)
	if role != models.RoleAdmin && role != models.RoleTechnician && role != models.RoleViewer {
		writeError(w, http.StatusBadRequest, "role must be one of: admin, technician, viewer")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	user, err := d.Users.Create(r.Context(), req.Email, hash, req.Name, role)
	if err != nil {
		writeError(w, http.StatusConflict, "a user with that email may already exist")
		return
	}

	actor, _ := auth.UserFromContext(r.Context())
	d.Audit.Log(r.Context(), actor.ID, "user.create", "user", user.ID, map[string]string{"email": req.Email, "role": req.Role})

	writeJSON(w, http.StatusCreated, user)
}
