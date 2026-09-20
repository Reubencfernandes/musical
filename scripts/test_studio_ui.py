from pathlib import Path
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
ABC='X:1\nT:Test recording\nM:4/4\nL:1/8\nQ:1/4=96\nK:C\n"C" E2 G2 c2 B2 | "Am" A3 G E2 C2 | "F" F2 A2 c2 A2 | "G" B2 G2 D4 |\n"C" E2 G2 c2 e2 | "Am" d2 c2 A4 | "F" A2 G2 F2 E2 | "C" D2 E2 C4 |]'
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://localhost:3000',wait_until='networkidle')
    page.wait_for_timeout(600)
    assert not page.locator('header').count()
    assert not page.get_by_text('Explore an example score').count()
    assert not page.get_by_role('spinbutton').count()
    assert page.evaluate("getComputedStyle(document.querySelector('.upload-panel')).boxShadow")=='none'
    page.screenshot(path='work/studio-input-dark.png')
    page.get_by_role('button',name='Switch to white mode').click()
    page.wait_for_timeout(350)
    assert page.evaluate('getComputedStyle(document.body).backgroundColor')=='rgb(255, 255, 255)'
    page.screenshot(path='work/studio-input-white.png')
    page.reload(wait_until='networkidle')
    assert page.get_by_role('button',name='Switch to dark mode').count()
    page.get_by_role('button',name='Switch to dark mode').click()
    def transcribe(route):
        page.locator('canvas[data-particles]').wait_for()
        assert int(page.locator('canvas').get_attribute('data-particles'))>100
        page.wait_for_timeout(350)
        a=page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        b=a
        for _ in range(10):
            page.wait_for_timeout(200)
            b=page.locator('canvas').evaluate('(c)=>c.toDataURL()')
            if a!=b: break
        assert a!=b,'Dots must actually move'
        assert not page.locator('.upload-panel').count()
        page.screenshot(path='work/studio-musician.png')
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_timeout(100)
        a=page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        page.wait_for_timeout(150)
        assert a==page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        page.emulate_media(reduced_motion='no-preference')
        route.fulfill(status=200,content_type='application/x-ndjson',body=json.dumps({'type':'result','data':{'abc':ABC,'status':'Test fixture','downloads':[]}})+'\n')
    page.route('**/api/transcribe',transcribe)
    page.get_by_label('Upload audio recording',exact=True).set_input_files('work/test-melody.wav')
    page.get_by_role('button',name='Create score',exact=True).click()
    page.locator('.paper .abcjs-notehead').first.wait_for()
    page.get_by_role('button',name='Edit notation').click()
    editor=page.get_by_role('textbox',name='Edit ABC notation')
    original=editor.input_value()
    page.locator('.paper .abcjs-notehead').first.click()
    page.get_by_role('button',name='Raise selected note').click()
    assert editor.input_value()!=original
    page.get_by_role('button',name='Undo',exact=True).click()
    assert editor.input_value()==original
    page.get_by_role('button',name='Redo',exact=True).click()
    assert editor.input_value()!=original
    page.get_by_role('button',name='Restore AI score').click()
    assert editor.input_value()==original
    page.wait_for_timeout(400)
    page.get_by_role('button',name='Play score',exact=True).click()
    page.wait_for_selector('.current-note',timeout=30000)
    page.wait_for_timeout(1500)
    assert float(page.get_by_role('slider',name='Playback position').input_value())>0
    page.get_by_role('button',name='Pause score',exact=True).click()
    at=page.get_by_role('slider',name='Playback position').input_value()
    page.wait_for_timeout(600)
    assert at==page.get_by_role('slider',name='Playback position').input_value()
    page.get_by_role('combobox',name='Playback speed').select_option('50')
    page.wait_for_timeout(400)
    page.get_by_role('button',name='Play score',exact=True).click()
    page.wait_for_selector('.current-note',timeout=30000)
    assert float(page.get_by_role('slider',name='Playback position').get_attribute('max'))>35
    page.get_by_role('button',name='Pause score',exact=True).click()
    page.locator('.download-menu summary').click()
    with page.expect_download() as d:
        page.get_by_role('button',name='Current score · MIDI').click()
    downloaded=d.value
    data=Path(downloaded.path()).read_bytes()
    assert data.startswith(b'MThd'),data[:100]
    page.locator('.download-menu summary').click()
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(300)
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path='work/studio-mobile-score.png')
    page.get_by_role('button',name='New score',exact=True).click()
    page.wait_for_timeout(600)
    page.screenshot(path='work/studio-mobile-input.png')
    page.get_by_role('button',name='Or record with your microphone').click()
    page.wait_for_timeout(1200)
    page.get_by_role('button',name='Stop recording ·',exact=False).click()
    page.get_by_role('button',name='Create score',exact=True).wait_for()
    assert not errors,errors
    print('PASS (fixture response): borderless dark/white UI, theme persistence, no demo/header/excerpts, animated particles, reduced motion, note editing, undo/redo/reset, playback, pause, speed, MIDI, mobile, microphone.')
    browser.close()
