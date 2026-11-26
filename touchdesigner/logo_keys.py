# Keyboard In DAT callbacks: every key you press in TouchDesigner is sent
# to the app, where it runs the SAME handler as a real key press in the
# browser. So the whole key map (README / press I) works here.
#
# Ctrl / Alt / Cmd combos are left alone - those are TouchDesigner's own
# shortcuts. Turn the "Keyboard to app" switch off on the logo component
# when you want to type in TouchDesigner without driving the show.

def onKey(dat, keyInfo):
    if not keyInfo.state:
        return
    comp = parent()
    if not comp.par.Keyboard.eval():
        return
    if keyInfo.ctrl or keyInfo.alt or keyInfo.cmd:
        return
    name = keyInfo.webCode or keyInfo.key
    if not name or name.startswith(('Shift', 'Control', 'Alt', 'Meta', 'OS')):
        return                      # a bare modifier key
    if len(name) > 1 and name[0] == 'F' and name[1:].isdigit():
        return                      # F1..F12 belong to TouchDesigner (F1 = perform)
    # G = next SVG shape. Here the Shape control changes (not the page by
    # itself), so the control always shows what is on the projector.
    # Order: the menu, then empty (= the logo), then round again.
    if name == 'KeyG' and not keyInfo.shift and getattr(comp.par, 'Shape', None) is not None:
        names = list(comp.par.Shape.menuNames) + ['']
        cur = comp.par.Shape.eval()
        i = names.index(cur) if cur in names else -1
        comp.par.Shape = names[(i + 1) % len(names)]
        return
    comp.op('api').module.key(name, keyInfo.shift)
    return


def onShortcut(dat, shortcutName, time):
    return
