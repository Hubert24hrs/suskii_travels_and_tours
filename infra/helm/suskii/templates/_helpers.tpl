{{/* Release-scoped name prefix, at most 40 characters so suffixed names stay valid. */}}
{{- define "suskii.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 40 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 40 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "suskii.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
suskii.io/environment: {{ .Values.global.environment }}
{{- end -}}

{{/* Selector labels of one component: include "suskii.selector" (list . "api") */}}
{{- define "suskii.selector" -}}
{{- $root := index . 0 -}}
app.kubernetes.io/name: {{ $root.Chart.Name }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}

{{/* Image reference by digest when set: include "suskii.image" (list . "api") */}}
{{- define "suskii.image" -}}
{{- $root := index . 0 -}}
{{- $image := index $root.Values.images (index . 1) -}}
{{- $repository := $image.repository -}}
{{- if $root.Values.global.registry -}}
{{- $repository = printf "%s/%s" $root.Values.global.registry $image.repository -}}
{{- end -}}
{{- if $image.digest -}}
{{- printf "%s@%s" $repository $image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repository $image.tag -}}
{{- end -}}
{{- end -}}

{{/* Host name of a public URL. */}}
{{- define "suskii.host" -}}
{{- . | trimPrefix "https://" | trimPrefix "http://" | trimSuffix "/" -}}
{{- end -}}

{{/* The images run as `node` (uid 1000) on a read-only root file system. */}}
{{- define "suskii.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
fsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "suskii.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "suskii.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/*
Plain environment entries from values, refusing keys the chart sets itself and names that look
like secrets (those belong in the component's Secret):
  include "suskii.plainEnv" (list "api.env" .Values.api.env (list "NODE_ENV" "API_PORT"))
*/}}
{{- define "suskii.plainEnv" -}}
{{- $path := index . 0 -}}
{{- $env := index . 1 -}}
{{- $reserved := index . 2 -}}
{{- range $key, $value := $env }}
{{- if has $key $reserved }}
{{- fail (printf "%s.%s is set by the chart" $path $key) }}
{{- end }}
{{- if regexMatch "(SECRET|TOKEN|PASSWORD|PRIVATE|HMAC|ENCRYPTION_KEY$|ENCRYPTION_PREVIOUS_KEYS|_HASH$|_KEY$|_APP_ID$|^DATABASE_URL$|^REDIS_URL$)" $key }}
{{- fail (printf "%s.%s looks like a secret: put it in the component's Secret" $path $key) }}
{{- end }}
- { name: {{ $key }}, value: {{ $value | quote }} }
{{- end }}
{{- end -}}
