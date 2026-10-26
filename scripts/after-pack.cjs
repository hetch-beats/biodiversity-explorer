// electron-builder afterPack hook: embed the "BE" icon (build/icon.ico) into
// the packaged Windows .exe, so Explorer, desktop/Start-menu shortcuts and a
// pinned taskbar entry show it.
//
// Why a hook: electron-builder's own exe editing (win.signAndEditExecutable)
// is off — on this machine it fails unpacking its winCodeSign tools, which
// needs the Windows symlink privilege. The rcedit npm package ships the same
// rcedit.exe directly, so this sets ONLY the icon; version info and signing
// are untouched.
const path = require('node:path')
const rcedit = require('rcedit')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const icon = path.join(context.packager.projectDir, 'build', 'icon.ico')
  await rcedit(exe, { icon })
  console.log(`  • embedded icon  file=${path.relative(context.packager.projectDir, exe)}`)
}
