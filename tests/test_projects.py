import ast
import base64
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import zlib
import struct

ROOT=Path(__file__).resolve().parents[1]

class ProjectCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source=ast.parse((ROOT/'asciipaper').read_text())
        defs=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='validate_project']
        scope={'json':json,'re':re,'math':math}
        exec(compile(ast.Module(body=defs,type_ignores=[]),'Linux project validator','exec'),scope)
        cls.validate=staticmethod(scope['validate_project'])
        cls.fixture={'format':'asciipaper.project','version':1,'title':'My ASCII ░',
          'spec':{'shader':'vec4 cell(vec2 uv){return vec4(uv,0.,1.);}','charset':' ░▒▓█','cell':8,'aspect':.55,'effects':{'crt':.3},'media':'old-name.png','frames':'never-copy.frames'},
          'media':{'name':'source.png','mime':'image/png','data':base64.b64encode(b'fixture-media-bytes').decode()}}
    def javascript(self,p):
        script="const p=require('./studio/project.js');try{process.stdout.write(JSON.stringify(p.validate(JSON.parse(require('fs').readFileSync(0,'utf8')))));}catch(e){process.stderr.write(e.message);process.exitCode=1;}"
        return subprocess.run(['node','-e',script],input=json.dumps(p),cwd=ROOT,capture_output=True,text=True)
    def test_large_video_payload_does_not_overflow_javascript_stack(self):
        p=json.loads(json.dumps(self.fixture));p['media']['data']='AAAA'*(512*1024)
        result=self.javascript(p)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.validate(p),json.loads(result.stdout))
    def test_javascript_and_linux_preserve_full_project(self):
        result=self.javascript(self.fixture)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.validate(self.fixture),json.loads(result.stdout))
        self.assertEqual(self.validate(self.fixture)['spec']['media'],'media/source.png')
        self.assertNotIn('frames',self.validate(self.fixture)['spec'])
    def test_both_reject_incompatible_or_incomplete_projects(self):
        patches=[{'version':2},{'format':'other'},{'media':None},{'spec':{'shader':'../../secret'}},
          {'media':{'name':'../outside','mime':'image/png','data':'AAAA'}},
          {'media':{'name':'source','mime':'text/html','data':'AAAA'}},
          {'media':{'name':'source','mime':'image/png','data':'%%%%'}},
          {'spec':{'shader':'vec4 cell(vec2 uv){return vec4(1.);}','cell':0}}]
        for patch in patches:
            p={**self.fixture,**patch}
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError):self.validate(p)
                self.assertNotEqual(self.javascript(p).returncode,0)
    def test_native_preset_lifecycle_under_address_sanitizer(self):
        with tempfile.TemporaryDirectory() as directory:
            binary=str(Path(directory)/'lifecycle')
            built=subprocess.run(['cc','-g','-fsanitize=address,undefined','-I'+str(ROOT/'native'),str(ROOT/'tests/preset_lifecycle.c'),str(ROOT/'native/presets.c'),'-lm','-o',binary],capture_output=True,text=True)
            self.assertEqual(built.returncode,0,built.stderr)
            run=subprocess.run([binary],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
    def test_png_capture_keeps_readable_recipe_and_valid_chunk_crc(self):
        png='iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAAA1BMVEX/AAAZ4gk3AAAAC0lEQVQI12NgQAUAABAAAaHFIcEAAAAASUVORK5CYII='
        code='asciipaper:v1:'+base64.urlsafe_b64encode(zlib.compress(b'{"cell":8}')).decode().rstrip('=')
        js="const P=require('./studio/project.js');P.pngWithRecipe(new Blob([Buffer.from(process.argv[1],'base64')]),process.argv[2]).then(async b=>process.stdout.write(Buffer.from(await b.arrayBuffer()).toString('base64')));"
        run=subprocess.run(['node','-e',js,png,code],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        data=base64.b64decode(run.stdout);offset=8;found=False
        while offset<len(data):
            length=struct.unpack('>I',data[offset:offset+4])[0];kind=data[offset+4:offset+8];payload=data[offset+8:offset+8+length]
            if kind==b'tEXt':
                self.assertEqual(payload,b'asciipaperRecipe\0'+code.encode())
                self.assertEqual(struct.unpack('>I',data[offset+8+length:offset+12+length])[0],zlib.crc32(kind+payload))
                found=True
            offset+=length+12
        self.assertTrue(found)
    def test_failed_linux_media_import_removes_partial_files(self):
        source=ast.parse((ROOT/'asciipaper').read_text())
        functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ['import_project','validate_project']]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);file=root/'input.asciipaper.json';file.write_text(json.dumps(self.fixture))
            def failed_decode(path):
                Path(str(path)+'.frames').write_bytes(b'partial')
                raise SystemExit('cannot decode fixture')
            scope={'json':json,'re':re,'math':math,'Path':Path,'USER_WALLPAPERS':root/'library',
              'NAME_RE':r'[A-Za-z0-9][A-Za-z0-9 _-]{0,47}','taken':lambda name:False,'make_frames':failed_decode}
            exec(compile(ast.Module(body=functions,type_ignores=[]),'Linux import','exec'),scope)
            with self.assertRaises(SystemExit):scope['import_project'](file)
            self.assertEqual(list((root/'library').rglob('*.*')),[])

if __name__=='__main__':unittest.main()
