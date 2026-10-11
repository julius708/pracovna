-- Default settings (the linen table from the spec, identical to the prototype).
insert into public.settings (key, value) values
  ('linen_table', '{
    "items": [
      {"key":"paplonV","label":"Paplón veľký","size":""},
      {"key":"paplonM","label":"Paplón malý","size":""},
      {"key":"vankus","label":"Vankúš","size":""},
      {"key":"plachta","label":"Plachta","size":""},
      {"key":"plachtaM","label":"Plachta malá","size":""},
      {"key":"plachta140","label":"Plachta","size":"140 cm"},
      {"key":"osuskaV","label":"Osuška veľká","size":""},
      {"key":"uterakM","label":"Uterák malý","size":""},
      {"key":"predlozka","label":"Uterák na nohy do kúpeľne","size":""},
      {"key":"toaletak","label":"Toaletný papier","size":""},
      {"key":"utierky","label":"Kuchynské utierky","size":"rolka"},
      {"key":"spongia","label":"Špongia na riad","size":""},
      {"key":"myckaKaps","label":"Kapsule do umývačky","size":""},
      {"key":"vreckoV","label":"Vrecko do koša veľké","size":""},
      {"key":"vreckoM","label":"Vrecko do koša malé","size":""}
    ],
    "beds": {
      "dvoj": {"paplonV":1,"vankus":2,"plachta":1},
      "jedno": {"paplonM":1,"vankus":1,"plachtaM":1},
      "gauc": {"paplonV":1,"vankus":2,"plachta":1}
    },
    "perGuest": {"osuskaV":1,"uterakM":1},
    "perBathroom": {"predlozka":1},
    "perApartment": {"utierky":1,"spongia":1,"myckaKaps":2},
    "checklist": []
  }'::jsonb),
  ('duvet_types', '{}'::jsonb)
on conflict (key) do nothing;
