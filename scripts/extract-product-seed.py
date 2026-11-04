"""Read the KiotViet price workbook into validated JSON; never change the source."""
import hashlib
import json
import sys
from decimal import Decimal
from pathlib import Path

import openpyxl

source, destination = map(Path, sys.argv[1:3])
workbook = openpyxl.load_workbook(source, data_only=True)
assert len(workbook.worksheets) == 1, 'Expected one worksheet'
sheet = workbook.active
rows = list(sheet.values)
assert rows[0] == ('Tên hàng', 'Đơn vị tính', 'Tồn kho', 'Giá vốn', 'Bảng giá chung', 'Giá chở đi', 'Giá sĩ'), 'Unexpected columns'
products = []
for number, row in enumerate(rows[1:], start=2):
    if all(value is None for value in row):
        continue
    name, unit, *values = row
    assert isinstance(name, str) and name.strip(), f'Invalid name at row {number}'
    for column, value in enumerate(values):
        if value is None:
            assert column >= 3, f'Missing stock/cost/general price at row {number}'
            values[column] = 0
            continue
        assert type(value) in (int, float), f'Invalid number at row {number}'
        decimal = Decimal(str(value))
        assert decimal.is_finite(), f'Non-finite number at row {number}'
        places = 3 if column == 0 else 2
        assert decimal == decimal.quantize(Decimal(10) ** -places), f'Excess precision at row {number}'
        assert abs(decimal) < Decimal(10) ** (14 - places), f'Overflow at row {number}'
        assert column == 0 or decimal >= 0, f'Negative price at row {number}'
    products.append(dict(row=number, name=name.strip(), unit=str(unit).strip() if unit else 'cái', stock=values[0], cost=values[1], prices=dict(zip(['Giá chung', 'Chở đi', 'Giá sĩ'], values[2:]))))
payload = dict(source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(), products=products)
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(rows=len(products), blankUnits=sum(r[1] is None for r in rows[1:]), negativeStock=sum(p['stock'] < 0 for p in products))))
