#!/usr/bin/env python3
"""
Sparkasse Bremen FinTS MCP Server — stdio transport

Configure via environment variables:
  SPARKASSE_FINTS_URL    — FinTS endpoint (default: Sparkasse Bremen)
  SPARKASSE_BLZ          — Bank code (default: 20050550)
  SPARKASSE_USER         — Online-Banking Benutzername / Kontonummer
  SPARKASSE_PIN          — Online-Banking PIN

Tools:
  - sparkasse_accounts      — List accounts with balances
  - sparkasse_transactions  — List recent transactions
  - sparkasse_transfer      — Initiate SEPA transfer (returns TAN challenge)
  - sparkasse_confirm_tan   — Confirm transfer with TAN
"""

import sys
import json
import os
import base64
import tempfile
import pickle
from decimal import Decimal
from datetime import date, timedelta

FINTS_URL = os.environ.get('SPARKASSE_FINTS_URL', 'https://www.sparkasse-bremen.de/xmlbanking/')
BLZ = os.environ.get('SPARKASSE_BLZ', '20050550')
USER = os.environ.get('SPARKASSE_USER', '')
PIN = os.environ.get('SPARKASSE_PIN', '')
PENDING_DIR = os.environ.get('SPARKASSE_STATE_DIR', '/opt/soul/connections')

# ── FinTS helpers ──────────────────────────────────────────

def create_client(stored_data=None):
    from fints.client import FinTS3PinTanClient
    client = FinTS3PinTanClient(BLZ, USER, PIN, FINTS_URL, product_id=None)
    if stored_data:
        client.set_data(base64.b64decode(stored_data))
    return client


def format_amount(amount):
    if hasattr(amount, 'amount'):
        return f"{amount.amount} {amount.currency}"
    return str(amount)


def format_account(acc):
    parts = [f"IBAN: {acc.iban}" if acc.iban else f"Konto: {acc.accountnumber}"]
    if acc.bic:
        parts.append(f"BIC: {acc.bic}")
    return ", ".join(parts)


# ── Tools ─────────────────────────────────────────────────

def tool_accounts():
    if not USER or not PIN:
        return "Keine Zugangsdaten konfiguriert (SPARKASSE_USER, SPARKASSE_PIN fehlen)."
    try:
        client = create_client()
        accounts = client.get_sepa_accounts()
        lines = [f"📋 Konten ({len(accounts)}):"]
        for acc in accounts:
            lines.append(f"\n{format_account(acc)}")
            try:
                bal = client.get_balance(acc)
                if bal:
                    lines.append(f"  Kontostand: {format_amount(bal.amount)}")
                    if hasattr(bal, 'date'):
                        lines.append(f"  Stand vom: {bal.date}")
            except Exception as e:
                lines.append(f"  (Kontostand nicht abrufbar: {e})")
        stored = base64.b64encode(client.deconstruct()).decode()
        _save_client_data(stored)
        return "\n".join(lines)
    except Exception as e:
        return f"Fehler: {e}"


def tool_transactions(days=30, iban=None):
    if not USER or not PIN:
        return "Keine Zugangsdaten konfiguriert."
    try:
        client = create_client(_load_client_data())
        accounts = client.get_sepa_accounts()
        if not accounts:
            return "Keine Konten gefunden."

        target = None
        if iban:
            target = next((a for a in accounts if a.iban == iban), None)
            if not target:
                return f"Konto mit IBAN {iban} nicht gefunden."
        else:
            target = accounts[0]

        start = date.today() - timedelta(days=int(days))
        transactions = client.get_transactions(target, start_date=start, end_date=date.today())

        lines = [f"📊 Transaktionen {target.iban} (letzte {days} Tage): {len(transactions)} Einträge\n"]
        for tx in transactions[-50:]:  # max 50
            d = str(getattr(tx.data, 'date', getattr(tx.data, 'entry_date', '?')))
            amount = format_amount(tx.data.amount)
            applicant = getattr(tx.data, 'applicant_name', '') or getattr(tx.data, 'beneficiary_name', '') or ''
            purpose = getattr(tx.data, 'purpose', '') or ''
            sign = "+" if not str(tx.data.amount).startswith('-') else ""
            lines.append(f"{d}  {sign}{amount}  {applicant}  {purpose[:60]}")

        stored = base64.b64encode(client.deconstruct()).decode()
        _save_client_data(stored)
        return "\n".join(lines)
    except Exception as e:
        return f"Fehler: {e}"


def tool_transfer(recipient_name, recipient_iban, recipient_bic, amount, purpose, iban=None):
    if not USER or not PIN:
        return "Keine Zugangsdaten konfiguriert."
    try:
        from fints.client import NeedTANResponse
        client = create_client(_load_client_data())
        accounts = client.get_sepa_accounts()
        if not accounts:
            return "Keine Konten gefunden."

        source = None
        if iban:
            source = next((a for a in accounts if a.iban == iban), None)
            if not source:
                return f"Konto mit IBAN {iban} nicht gefunden."
        else:
            source = accounts[0]

        result = client.simple_sepa_transfer(
            account=source,
            iban=recipient_iban,
            bic=recipient_bic,
            recipient_name=recipient_name,
            amount=Decimal(str(amount)),
            account_name=USER,
            reason=purpose,
        )

        if isinstance(result, NeedTANResponse):
            # Save pending state
            transfer_id = _save_pending_transfer(client, result)
            challenge_text = result.challenge or "Bitte TAN eingeben"
            if hasattr(result, 'challenge_html') and result.challenge_html:
                challenge_text = result.challenge_html.replace('<br>', '\n').replace('<br/>', '\n')
            return (
                f"🔐 TAN erforderlich\n"
                f"Transfer-ID: {transfer_id}\n"
                f"Herausforderung: {challenge_text}\n\n"
                f"Bitte rufe sparkasse_confirm_tan mit der Transfer-ID und der TAN auf."
            )
        else:
            stored = base64.b64encode(client.deconstruct()).decode()
            _save_client_data(stored)
            return f"✅ Überweisung ausgeführt: {amount} EUR an {recipient_name} ({recipient_iban})"

    except Exception as e:
        return f"Fehler: {e}"


def tool_confirm_tan(transfer_id, tan):
    if not USER or not PIN:
        return "Keine Zugangsdaten konfiguriert."
    try:
        from fints.client import NeedTANResponse
        client_data, challenge_data = _load_pending_transfer(transfer_id)
        if not client_data or not challenge_data:
            return f"Kein ausstehender Transfer mit ID {transfer_id} gefunden."

        client = create_client(client_data)
        challenge = NeedTANResponse.from_data(base64.b64decode(challenge_data))

        client.send_tan(challenge, tan.strip())

        stored = base64.b64encode(client.deconstruct()).decode()
        _save_client_data(stored)
        _delete_pending_transfer(transfer_id)
        return f"✅ Überweisung bestätigt. TAN akzeptiert."

    except Exception as e:
        return f"Fehler bei TAN-Bestätigung: {e}"


# ── State persistence ──────────────────────────────────────

def _client_data_path():
    os.makedirs(PENDING_DIR, exist_ok=True)
    return os.path.join(PENDING_DIR, 'sparkasse-client.b64')


def _save_client_data(data_b64):
    try:
        with open(_client_data_path(), 'w') as f:
            f.write(data_b64)
    except Exception:
        pass


def _load_client_data():
    try:
        with open(_client_data_path()) as f:
            return f.read().strip()
    except Exception:
        return None


def _save_pending_transfer(client, challenge):
    import uuid
    transfer_id = str(uuid.uuid4())[:8]
    os.makedirs(PENDING_DIR, exist_ok=True)

    client_data = base64.b64encode(client.deconstruct()).decode()
    challenge_data = base64.b64encode(challenge.get_data()).decode()

    state = {'client': client_data, 'challenge': challenge_data}
    path = os.path.join(PENDING_DIR, f'sparkasse-pending-{transfer_id}.json')
    with open(path, 'w') as f:
        json.dump(state, f)
    return transfer_id


def _load_pending_transfer(transfer_id):
    path = os.path.join(PENDING_DIR, f'sparkasse-pending-{transfer_id}.json')
    try:
        with open(path) as f:
            state = json.load(f)
        return state['client'], state['challenge']
    except Exception:
        return None, None


def _delete_pending_transfer(transfer_id):
    path = os.path.join(PENDING_DIR, f'sparkasse-pending-{transfer_id}.json')
    try:
        os.remove(path)
    except Exception:
        pass


# ── MCP Protocol ──────────────────────────────────────────

TOOLS = [
    {
        "name": "sparkasse_accounts",
        "description": "Zeigt alle Sparkasse-Konten mit aktuellem Kontostand.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "sparkasse_transactions",
        "description": "Listet die Transaktionen der letzten N Tage. Optional für eine bestimmte IBAN.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "days": {"type": "number", "description": "Anzahl der Tage zurück (Standard: 30)"},
                "iban": {"type": "string", "description": "Konto-IBAN (optional, Standard: erstes Konto)"},
            },
        },
    },
    {
        "name": "sparkasse_transfer",
        "description": "Initiiert eine SEPA-Überweisung. Gibt eine TAN-Herausforderung zurück, die mit sparkasse_confirm_tan bestätigt werden muss.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "recipient_name": {"type": "string", "description": "Name des Empfängers"},
                "recipient_iban": {"type": "string", "description": "IBAN des Empfängers"},
                "recipient_bic": {"type": "string", "description": "BIC des Empfängers"},
                "amount": {"type": "number", "description": "Betrag in EUR"},
                "purpose": {"type": "string", "description": "Verwendungszweck"},
                "iban": {"type": "string", "description": "Quell-IBAN (optional, Standard: erstes Konto)"},
            },
            "required": ["recipient_name", "recipient_iban", "recipient_bic", "amount", "purpose"],
        },
    },
    {
        "name": "sparkasse_confirm_tan",
        "description": "Bestätigt eine ausstehende Überweisung mit der TAN.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "transfer_id": {"type": "string", "description": "Transfer-ID aus sparkasse_transfer"},
                "tan": {"type": "string", "description": "Die TAN aus der Banking-App oder dem TAN-Generator"},
            },
            "required": ["transfer_id", "tan"],
        },
    },
]


def send(obj):
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()


def handle_request(req):
    req_id = req.get('id')
    method = req.get('method', '')
    params = req.get('params', {})

    if method == 'initialize':
        send({"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "sparkasse-mcp", "version": "1.0.0"},
        }})
        return

    if method == 'notifications/initialized':
        return

    if method == 'tools/list':
        send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})
        return

    if method == 'tools/call':
        name = params.get('name', '')
        args = params.get('arguments', {})
        try:
            if name == 'sparkasse_accounts':
                result = tool_accounts()
            elif name == 'sparkasse_transactions':
                result = tool_transactions(
                    days=args.get('days', 30),
                    iban=args.get('iban'),
                )
            elif name == 'sparkasse_transfer':
                result = tool_transfer(
                    recipient_name=args['recipient_name'],
                    recipient_iban=args['recipient_iban'],
                    recipient_bic=args['recipient_bic'],
                    amount=args['amount'],
                    purpose=args['purpose'],
                    iban=args.get('iban'),
                )
            elif name == 'sparkasse_confirm_tan':
                result = tool_confirm_tan(
                    transfer_id=args['transfer_id'],
                    tan=args['tan'],
                )
            else:
                result = f"Unbekanntes Tool: {name}"

            send({"jsonrpc": "2.0", "id": req_id, "result": {
                "content": [{"type": "text", "text": result}]
            }})
        except Exception as e:
            send({"jsonrpc": "2.0", "id": req_id, "result": {
                "content": [{"type": "text", "text": f"Fehler: {e}"}],
                "isError": True,
            }})
        return

    send({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            handle_request(req)
        except json.JSONDecodeError:
            pass
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()


if __name__ == '__main__':
    main()
