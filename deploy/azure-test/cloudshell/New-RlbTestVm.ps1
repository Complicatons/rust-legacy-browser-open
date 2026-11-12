<#
.SYNOPSIS
  RUN IN AZURE CLOUD SHELL (PowerShell), signed in to your own Azure account. Creates the test VM for the original
  Rust Legacy server:
    - resource group rlb-test-rg in UK West (a 2026 free account offered no VM sizes at all in UK South, and only the
      newest v7 sizes in UK West),
    - network security group: RDP 3389, website 8080 and gateway 28443 open ONLY to -MyIp (your home IP), nothing else
      inbound (UDP 29015 stays closed: the gateway reaches the server on the VM itself),
    - Windows Server 2022 Datacenter Gen2, Standard_D2as_v7 (2 vCPU, 8 GB, NVMe disk controller), 128 GB standard SSD,
      static public IP,
    - automatic shutdown at 23:00 UTC every day (no charge for compute while stopped and deallocated).
  az asks you for the VM administrator password (user rlbadmin); it is never stored by this script.
  Delete everything afterwards with:  az group delete --name rlb-test-rg --yes
.EXAMPLE
  ./New-RlbTestVm.ps1 -MyIp 203.0.113.7
#>
param(
    [Parameter(Mandatory = $true)][string]$MyIp,
    [string]$Location = 'ukwest',
    [string]$Size = 'Standard_D2as_v7',
    [string]$Prefix = 'rlb-test',
    [string]$AdminUser = 'rlbadmin',
    [string]$ShutdownUtc = '2300'
)
$ErrorActionPreference = 'Stop'
if (-not ($MyIp -as [Net.IPAddress]) -or $MyIp -match '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)') { throw "-MyIp must be your public IPv4 address (search 'what is my IP' on your PC)." }
$rg = "$Prefix-rg"; $nsg = "$Prefix-nsg"; $vm = "$Prefix-vm"
function Invoke-Az { az @args; if ($LASTEXITCODE) { throw "az $($args -join ' ') failed ($LASTEXITCODE)" } }

Write-Host "Creating $vm ($Size, Windows Server 2022) in $Location; inbound only from $MyIp." -ForegroundColor Cyan
# Which sizes this subscription may use where: az vm list-skus -l <region> --resource-type virtualMachines (slow: ~2 min per
# region). Zone-only restrictions do not block a non-zonal VM; Location restrictions do.
Invoke-Az group create --name $rg --location $Location --output none
Invoke-Az network nsg create --resource-group $rg --name $nsg --location $Location --output none
Invoke-Az network nsg rule create --resource-group $rg --nsg-name $nsg --name rdp-from-owner --priority 100 --direction Inbound --access Allow `
    --protocol Tcp --source-address-prefixes "$MyIp/32" --destination-port-ranges 3389 --output none
Invoke-Az network nsg rule create --resource-group $rg --nsg-name $nsg --name web-from-owner --priority 110 --direction Inbound --access Allow `
    --protocol Tcp --source-address-prefixes "$MyIp/32" --destination-port-ranges 8080 28443 --output none
Write-Host 'az will now ask for the VM administrator password (12-123 characters, upper, lower, digit and symbol).' -ForegroundColor Yellow
Invoke-Az vm create --resource-group $rg --name $vm --location $Location --image MicrosoftWindowsServer:WindowsServer:2022-datacenter-g2:latest `
    --size $Size --disk-controller-type NVMe --admin-username $AdminUser `
    --nsg $nsg --public-ip-sku Standard --public-ip-address-allocation static --storage-sku StandardSSD_LRS --os-disk-size-gb 128 --output none
Invoke-Az vm auto-shutdown --resource-group $rg --name $vm --time $ShutdownUtc --location $Location --output none
$ip = az vm show --show-details --resource-group $rg --name $vm --query publicIps --output tsv
Write-Host ''
Write-Host "VM ready. Public IP: $ip" -ForegroundColor Green
Write-Host "  Connect:      Remote Desktop to $ip as $AdminUser"
Write-Host "  Then on the VM: deploy\azure-test\RUNBOOK.md, starting with 01-Set-AzureConfig.ps1 -PublicIp $ip"
Write-Host "  Stop (no compute charge): az vm deallocate --resource-group $rg --name $vm"
Write-Host "  Start again:  az vm start --resource-group $rg --name $vm"
Write-Host "  Delete all:   az group delete --name $rg --yes"
