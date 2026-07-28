# --- build stage ---
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o solar-monitor ./cmd/server

# --- runtime stage ---
FROM alpine:3.20
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/solar-monitor .
COPY --from=builder /app/migrations ./migrations

EXPOSE 8080
ENTRYPOINT ["./solar-monitor"]
