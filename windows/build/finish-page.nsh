!ifndef VPLUS_FINISH_PAGE_INCLUDED
!define VPLUS_FINISH_PAGE_INCLUDED

; Shared completion UI; the caller supplies the actual launch action.
!macro VPlusFinishPage launchFunction
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open V+ after setup"
  !define MUI_FINISHPAGE_RUN_FUNCTION "${launchFunction}"
  !define MUI_FINISHPAGE_BUTTON "Open V+"
  !define MUI_FINISHPAGE_TEXT "V+ has been installed on your computer.$\r$\n$\r$\nClick Open V+ to close Setup and launch the app.$\r$\nUncheck the option below to finish without opening V+."
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW VPlusFinishShow
  !insertmacro MUI_PAGE_FINISH

  Function VPlusFinishToggle
    Pop $0
    ${NSD_GetState} $mui.FinishPage.Run $0
    ${If} $0 == ${BST_CHECKED}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:Open V+"
    ${Else}
      SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:Finish"
    ${EndIf}
  FunctionEnd

  Function VPlusFinishShow
    ${NSD_OnClick} $mui.FinishPage.Run VPlusFinishToggle
  FunctionEnd
!macroend
!endif
