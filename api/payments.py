"""Cobros de la red social.

Hoy el único proveedor es "mock": aprueba todo al instante y NO mueve dinero real.
Para cobrar de verdad, implementar un proveedor en `charge()` (ej. Mercado Pago o
Stripe Connect para repartir al vendedor) y setear PAYMENT_PROVIDER.
"""
import os
import secrets
from decimal import ROUND_HALF_UP, Decimal

PROVIDER = os.environ.get("PAYMENT_PROVIDER", "mock")
FEE_PCT = Decimal(os.environ.get("PLATFORM_FEE_PCT", "5"))
CENT = Decimal("0.01")


def platform_fee(amount: Decimal) -> Decimal:
    return (amount * FEE_PCT / 100).quantize(CENT, rounding=ROUND_HALF_UP)


def charge(amount: Decimal, description: str, buyer_id: int, seller_id: int) -> str:
    """Cobra `amount` al comprador y devuelve la referencia del pago."""
    if PROVIDER == "mock":
        return f"mock_{secrets.token_hex(8)}"
    raise RuntimeError(f"Proveedor de pagos no soportado: {PROVIDER}")


def refund(payment_ref: str) -> None:
    if PROVIDER == "mock":
        return
    raise RuntimeError(f"Proveedor de pagos no soportado: {PROVIDER}")
