// DSH web2 lazy client-module contract; React is supplied by the host.
window.__ModuleLoader__.load({
  id: '@ai-native-game-harness/desktop-game-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const css = `
      .agh-native-settings { color:inherit; font:inherit; max-width:720px; }
      .agh-native-settings h2 { font-size:20px; line-height:1.4; margin:0 0 8px; }
      .agh-native-settings h3 { font-size:15px; margin:0 0 8px; }
      .agh-native-settings p { font-size:13px; line-height:1.7; margin:8px 0 18px; opacity:.75; }
      .agh-native-settings section { padding:20px 0; border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent); }
      .agh-native-settings a { display:inline-flex; flex-wrap:wrap; align-items:center; gap:12px; max-width:100%; box-sizing:border-box; padding:10px 14px; border:1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius:8px; text-decoration:none; color:inherit; font-size:13px; }
      .agh-native-settings a:hover { background:color-mix(in srgb,currentColor 6%,transparent); }
      .agh-native-settings a:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
      .agh-native-settings kbd { font:11px inherit; opacity:.6; white-space:nowrap; }
      .agh-native-settings .agh-settings-note { font-size:12px; margin-top:20px; }
      .agh-native-settings [data-agh-test-settings]:empty { display:none; }
      @media (max-width:600px) {
        /* Only our pages adapt the shell geometry; no hashed class selectors. */
        [role=dialog]:has(.agh-native-settings) { flex-direction:column; }
        [role=dialog]:has(.agh-native-settings) > nav { width:auto; flex:0 0 auto; padding:12px; }
        [role=dialog]:has(.agh-native-settings) > nav > div:last-child { display:flex; flex-direction:row; gap:4px; overflow-x:auto; }
        [role=dialog]:has(.agh-native-settings) > nav button { width:auto; flex:0 0 auto; white-space:nowrap; }
        [role=dialog]:has(.agh-native-settings) > nav + div { min-width:0; min-height:0; width:auto; flex:1; }
        [role=dialog]:has(.agh-native-settings) > nav + div > div:last-child { padding:16px; }
      }
    `
    function link(href, text, shortcut) {
      return h('a', { href }, text, h('kbd', null, shortcut))
    }
    function GameSettings() {
      // The Desktop composition may mount its optional test control here.
      // No dependency on that composition or its account/provider APIs.
      return h('div', { className: 'agh-native-settings' },
        h('h2', null, '游戏'),
        h('p', null, '查看游戏连接、伙伴对话与当前存档。'),
        h('section', null,
          h('h3', null, '游戏页面'),
          h('p', null, '回到游戏专属页面，继续使用现有的对话、剧情和分析功能。'),
          link('ai-native-game-harness://game', '打开游戏页面', 'Ctrl+2')),
        h('div', { 'data-agh-test-settings': '', id: 'agh-game-test-settings' }),
        h('p', { className: 'agh-settings-note' }, '也可以通过桌面菜单「页面 → 游戏」快速切换。'))
    }
    function DeveloperSettings() {
      return h('div', { className: 'agh-native-settings' },
        h('h2', null, '开发者工具'),
        h('p', null, '开发验证入口，日常聊天和玩游戏不需要打开。'),
        h('section', null,
          h('h3', null, '自动测评'),
          h('p', null, '打开测评页面后手动开始；仅进入此页不会运行测试或操作游戏。'),
          link('ai-native-game-harness://evaluation', '打开自动测评', 'Ctrl+3')))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.aghNativeSettings = ''
        style.textContent = css
        document.head.append(style)
        ctx.on('dispose', () => style.remove())
        ctx.slots.inject('settings.section', () => {
          ctx.slots.register({ name: 'settings.section', id: 'agh-game', order: 45, label: '游戏' }, GameSettings)
          ctx.slots.register({ name: 'settings.section', id: 'agh-developer', order: 90, label: '开发者工具' }, DeveloperSettings)
        })
      }
    }
  }
})
