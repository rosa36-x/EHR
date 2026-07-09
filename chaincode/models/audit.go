package models

type AuditLog struct {
	AuditID      string `json:"auditID"`
	ActorID      string `json:"actorID"`
	ActorRole    string `json:"actorRole"`
	ActorOrg     string `json:"actorOrg"`
	Action       string `json:"action"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceID"`
	Timestamp    string `json:"timestamp"`
}