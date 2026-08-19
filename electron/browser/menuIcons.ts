// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { nativeImage, type NativeImage } from 'electron';

/**
 * Two-times PNGs for Electron's native context menu.
 *
 * They are monochrome template images on macOS, so AppKit supplies the correct
 * foreground for light, dark, selected and disabled menu rows. Keeping the
 * bytes here also makes the icons available in development and packaged builds
 * without introducing another copied-assets path in electron-builder.
 */
const PNG_2X = {
  copy: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbElEQVR42u1VWw7AIAyyjfe/MjvAjI+tpJvCr0ENj1CKICTDOmcg3HmDBz++zPVsC2qgpI9US1dAH6ikpGM2T86u2Yj7WwtakqIjNdSCNxaAFMhvW2CkiV+ywCZkN23BsWO0fw3DahbIFTbFBZnyDjfO0XAcAAAAAElFTkSuQmCC',
  search: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkElEQVR42u2WQRKAMAgDA///c/yAM4WW0B7I0UG7oIYAo9FlWbKeBc/YupmCZgAAXnR4pi5FzUA9Tybhh4f/XWf1K4h0tf0heqB724Bk9QRkGoBnAezQiKx6AoTABVcAUYMhxMuIykXnqi0XBa/OA+m8YII/KwXhTSmL3UYUhvDmvMluK15C+IXkbbgkYvSiPhELGidg26x0AAAAAElFTkSuQmCC',
  external: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAeUlEQVR42u1Whw3AMAwCy/+/7J7QDGRU1RwQCBAUYPB3UHBG3XCG4dLlFiCP4CQedjiw1I1wkgNACtv9FnXtOFBdPQt3yVP0Uo4dC8MSSgVcdyXE5NvDlo3kVDpA1aSH4InRWUI6SyjBCLALyI61+2QEir8iMRgs4AEJgQ451YxVawAAAABJRU5ErkJggg==',
  quote: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAdUlEQVR42u2WSw4AIQhDC/H+V8YDzMJPGZoY3r4WoRiBpmnOiGytXxwQhPlHa8StU7SuNAeAcdhKIzJgbAbSzVcFBGG+rXXVzVcFRNVb4RAjL8Au22jECCyjA2kZcUXyUbHfu9reAnkBo/L389QIyta0aX5nAv2lFii6Fm9iAAAAAElFTkSuQmCC',
  book: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAcUlEQVR42u2XMQ5AIQhD6Q/3vzLOf1GgMpi0s5SHYShmkpRXTLxHsxhEY5yMKpOCrfPGpJFomh7MG7uAjSGqZh+xlGCbswBXJAABCEAAAhDAUwAjmdCLJlHMhGFk5JoSMqkYxNemfWF37wTYAweL9NMCDpkWLK3DfTUAAAAASUVORK5CYII=',
  chat: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbElEQVR42u2WMQ5AIQhDKfH+V/bvP4YBpAy2qwl9CApmkjQsBGeb4edE82NcJ5of469CicrZRyWgSQACEIAABDAOsDIDpPsGYMQlyAljOIyL7By/BYyiObqbsH1T8kT2YK3lfwhMfkTdT/NhfQPCCzZanB0XAAAAAElFTkSuQmCC',
  back: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAc0lEQVR42u2WwREAMQgCo/33zLWQeIt+5E/YYYzjOavVipGqxgTDNQGgv00kXHt0ASDhFZOgd0oN4OEvZtHBLw3Ywm8ArOE3AOEMrzSgboAg9351CK0QMb0HEoBVVwOW75kgePs9gEAkPMT4orLfhKvVuD4CfhYfzq2vDgAAAABJRU5ErkJggg==',
  forward: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAd0lEQVR42u2WAQ7AMAgCxf//2X1gSdMBmiXygHJFa41YrVacij0gBeY1AVCqJL4CQFUOpgQSCBgbEe4ETkbVlcDJFO4EqL5QA1xDOADeINANUJMJXDViTr8CmH9FdAwiahKiO3LHPkBdKCfNlfsAIn66E65W43oAckAWH/vAVMYAAAAASUVORK5CYII=',
  refresh: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAlUlEQVR42u2WUQ7AIAhDLdn9r9xdwCkC3bKEfjrAV9GMMVotvbj6CEFRPMRN97LAxgxCMgvAQ1hUBfEgl5N1rvIs0H8swI8N4SAYgku6PAG+8Uat8kI5WgUvQNY9vHVN5N6db+NjNcAvALIvghEAiAwj2gIq3O8AoHYf/R2X5lyJY0VFqyCciFz1TQRbOpKlBo5Wa6cbqn0bLTd9i/sAAAAASUVORK5CYII=',
  globe: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAkElEQVR42u1WWw6AMAijxPtfuf5r4gCBaUK/B4yWl8hgsBkI2jHLJxIDh3xrUXDzeyTSHZJFdxehOrLHIitE2NFEzUNSqqOiadD0mjWiErBIckYYgBQOOzQzcIv5+TYsx+GgjEZdubB1M8CK/l99AF3rXx1ZWEYrH4aXWwJ0HD+zjlF4EcmbZZRRE/jFVTwYnFAOHCyx3su2AAAAAElFTkSuQmCC',
} as const;

export type BrowserMenuIcon = keyof typeof PNG_2X;

const cache = new Map<BrowserMenuIcon, NativeImage>();

export function browserMenuIcon(name: BrowserMenuIcon): NativeImage {
  const existing = cache.get(name);
  if (existing) return existing;
  const image = nativeImage.createFromBuffer(Buffer.from(PNG_2X[name], 'base64'), { scaleFactor: 2 });
  image.setTemplateImage(true);
  cache.set(name, image);
  return image;
}
