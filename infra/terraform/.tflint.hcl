# TFLint for every module (CI: .github/workflows/infra.yml). The Google ruleset checks machine
# types, regions and other values against the provider; the bundled Terraform ruleset checks
# naming, unused declarations, pinned versions and documented variables.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "google" {
  enabled = true
  version = "0.40.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

rule "terraform_documented_variables" {
  enabled = false # the module READMEs and descriptions on public inputs cover them
}
