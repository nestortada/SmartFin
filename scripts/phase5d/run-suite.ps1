param([string]$Serial='emulator-5554',[int]$Api=24,[string]$Prefix='accepted')
$ErrorActionPreference='Stop'
function Run-DeliveryCampaign([string]$Campaign,[string]$Name,[switch]$Denied) {
  ./scripts/phase5d/run-android.ps1 -Serial $Serial -Campaign $Campaign -DenyNotifications:$Denied -Output "docs/atomicidad-fase5d/android/api$Api/$Prefix-$Name"
}
Run-DeliveryCampaign phase5d-matrix matrix
Run-DeliveryCampaign phase5d-permission permission -Denied
Run-DeliveryCampaign phase5d-recovery recovery
foreach($deliveryStage in @('beforeNotify','afterNotify','afterAck')) {
  Run-DeliveryCampaign "phase5d-kill-$deliveryStage" "kill-$deliveryStage"
  Run-DeliveryCampaign phase5d-restart "restart-$deliveryStage"
}
Run-DeliveryCampaign phase5d-stage-restart normal-stage
Run-DeliveryCampaign phase5d-restart normal-restart
Run-DeliveryCampaign phase5d-epoch epoch
foreach($regressionCampaign in @('core','restart-verify','publication','publication-restart-verify','publication-after-verify','close-lost','open-lost')) {
  Run-DeliveryCampaign $regressionCampaign "regression-$regressionCampaign"
}
