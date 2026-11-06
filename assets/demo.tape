Output assets/demo.gif
Set Shell "powershell"
Set FontSize 16
Set Width 1000
Set Height 760
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 60ms

Hide
Type `function prompt { "$ " }; clear`
Enter
Show

Sleep 500ms
Type "node src/cli.ts --demo"
Sleep 400ms
Enter
Sleep 9s
