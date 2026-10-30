; electron-builder incluye este archivo en el instalador NSIS (nsis.include por defecto: build/installer.nsh).

; Al desinstalar se borra el skill de Claude Code que escribió Nautilus. En una actualización, el instalador nuevo
; corre el desinstalador viejo: ahí se conserva, y la versión nueva lo reescribe al arrancar.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$PROFILE\.claude\skills\nautilus\SKILL.md"
    Delete "$PROFILE\.claude\skills\nautilus\importar.ps1"
    RMDir "$PROFILE\.claude\skills\nautilus"
  ${endIf}
!macroend
