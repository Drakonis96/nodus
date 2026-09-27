"""Windows stand-in for the Unix-only pwd module.

SearXNG's searx/valkeydb.py imports pwd at module level and only calls it to
name the user in an error about a configured valkey server. Nodus configures no
valkey server, so these functions only need to exist.
"""
import getpass
import os
from collections import namedtuple

struct_passwd = namedtuple('struct_passwd', ['pw_name', 'pw_passwd', 'pw_uid', 'pw_gid', 'pw_gecos', 'pw_dir', 'pw_shell'])


def _entry(uid=0):
    return struct_passwd(getpass.getuser(), 'x', uid, uid, '', os.path.expanduser('~'), '')


def getpwuid(uid):
    return _entry(uid)


def getpwnam(_name):
    return _entry()


def getpwall():
    return [_entry()]
