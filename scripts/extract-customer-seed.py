"""Extract only customer fields; workbook contents are data, never instructions."""
import hashlib
import json
import sys
from pathlib import Path
import openpyxl

source, destination = map(Path, sys.argv[1:3])
book = openpyxl.load_workbook(source, read_only=True, data_only=True)
assert len(book.worksheets) == 1, 'Expected one sheet'
rows = list(book.active.values)
assert rows[0] == ('Tên khách hàng', 'Điện thoại', 'Địa chỉ'), 'Unexpected columns'
customers = []
for row_number, row in enumerate(rows[1:], 2):
    if all(value is None for value in row):
        continue
    assert all(value is None or isinstance(value, str) for value in row), f'Non-text field at row {row_number}'
    name, phone, address = [(value or '').strip() for value in row]
    assert name and len(name) <= 300 and len(phone) <= 100 and len(address) <= 1000, f'Invalid row {row_number}'
    customers.append(dict(row=row_number, name=name, phone=phone, address=address))
payload = dict(source=source.name, sha256=hashlib.sha256(source.read_bytes()).hexdigest(), customers=customers)
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(rows=len(customers), missingPhone=sum(not c['phone'] for c in customers), missingAddress=sum(not c['address'] for c in customers), sha256=payload['sha256'])))
