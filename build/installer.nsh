; Registers Pulse as a web browser for the current user, so it shows up in
; Settings → Apps → Default apps (Windows never lets an app make itself the default).
; Only Pulse's own keys are written; the system's http/https classes are left alone.

!define PULSE_CLIENT "Software\Clients\StartMenuInternet\Pulse"
!define PULSE_PROGID "Software\Classes\PulseHTML"

!macro customInstall
  StrCpy $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  WriteRegStr HKCU "${PULSE_PROGID}" "" "Pulse Web Page"
  WriteRegStr HKCU "${PULSE_PROGID}" "URL Protocol" ""
  WriteRegStr HKCU "${PULSE_PROGID}\Application" "ApplicationName" "Pulse"
  WriteRegStr HKCU "${PULSE_PROGID}\Application" "ApplicationIcon" "$0,0"
  WriteRegStr HKCU "${PULSE_PROGID}\DefaultIcon" "" "$0,0"
  WriteRegStr HKCU "${PULSE_PROGID}\shell\open\command" "" '"$0" "%1"'

  WriteRegStr HKCU "${PULSE_CLIENT}" "" "Pulse"
  WriteRegStr HKCU "${PULSE_CLIENT}\DefaultIcon" "" "$0,0"
  WriteRegStr HKCU "${PULSE_CLIENT}\shell\open\command" "" '"$0"'
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities" "ApplicationName" "Pulse"
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities" "ApplicationDescription" "Browser with a built-in AI agent"
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities" "ApplicationIcon" "$0,0"
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "Pulse"
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities\URLAssociations" "http" "PulseHTML"
  WriteRegStr HKCU "${PULSE_CLIENT}\Capabilities\URLAssociations" "https" "PulseHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "Pulse" "${PULSE_CLIENT}\Capabilities"

  ; SHCNE_ASSOCCHANGED: let Explorer and Settings pick up the new browser right away.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; keep the registration so the default browser choice survives.
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "${PULSE_PROGID}"
    DeleteRegKey HKCU "${PULSE_CLIENT}"
    DeleteRegValue HKCU "Software\RegisteredApplications" "Pulse"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
