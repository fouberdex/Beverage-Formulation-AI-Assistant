param(
    [string]$Config = "config/soda.yaml",
    [int]$Limit = 300
)

$ErrorActionPreference = "Stop"
beverage-rag validate-config --config $Config
beverage-rag ingest --source all --limit $Limit --config $Config
beverage-rag preprocess --config $Config
beverage-rag index --config $Config

