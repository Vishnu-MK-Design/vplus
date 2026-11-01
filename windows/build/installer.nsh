!include "${__FILEDIR__}\finish-page.nsh"

!macro customFinishPage
  !insertmacro VPlusFinishPage "StartApp"
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ; Use electron-builder's installed application link and original user context.
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
!macroend
