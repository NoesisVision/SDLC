# /// script
# dependencies = []
# ///

"""Programmatic grader for implement-design-doc-java evals.

Checks structural assertions by scanning generated Java files.
"""

import json
import os
import re
import sys
from pathlib import Path


def find_java_files(directory: str) -> list[Path]:
    return sorted(Path(directory).rglob("*.java"))


def read_all_java(directory: str) -> dict[str, str]:
    result = {}
    for f in find_java_files(directory):
        result[f.name] = f.read_text()
    return result


def file_contains(files: dict[str, str], pattern: str) -> bool:
    for content in files.values():
        if re.search(pattern, content):
            return True
    return False


def any_file_named(files: dict[str, str], name: str) -> bool:
    return name in files


def file_content(files: dict[str, str], name: str) -> str:
    return files.get(name, "")


# --- Eval 1: Shipping Lombok Spring ---

def grade_shipping(files: dict[str, str]) -> list[dict]:
    results = []

    # 1. correct_package_placement
    has_domain_pkg = file_contains(files, r"package\s+com\.example\.orders\.shipping\.domain")
    has_app_pkg = file_contains(files, r"package\s+com\.example\.orders\.shipping\.application")
    results.append({
        "text": "correct_package_placement",
        "passed": has_domain_pkg and has_app_pkg,
        "evidence": f"domain pkg: {has_domain_pkg}, application pkg: {has_app_pkg}"
    })

    # 2. facade_pattern_followed
    facade_files = [n for n in files if "Facade" in n and "Shipping" in n]
    has_facade = len(facade_files) > 0
    facade_public = False
    if has_facade:
        fc = file_content(files, facade_files[0])
        facade_public = "public class" in fc or "public final class" in fc
    results.append({
        "text": "facade_pattern_followed",
        "passed": has_facade and facade_public,
        "evidence": f"facade files: {facade_files}, public: {facade_public}"
    })

    # 3. spring_configuration_present
    config_files = [n for n in files if "Configuration" in n and "Shipping" in n]
    has_config = len(config_files) > 0
    has_bean = False
    if has_config:
        cc = file_content(files, config_files[0])
        has_bean = "@Bean" in cc and "@Configuration" in cc
    results.append({
        "text": "spring_configuration_present",
        "passed": has_config and has_bean,
        "evidence": f"config files: {config_files}, @Bean+@Configuration: {has_bean}"
    })

    # 4. lombok_value_for_vos
    vo_names = ["ShipmentId.java", "ShippingAddress.java", "TrackingNumber.java"]
    vos_with_value = 0
    for vo in vo_names:
        c = file_content(files, vo)
        if "@Value" in c:
            vos_with_value += 1
    results.append({
        "text": "lombok_value_for_vos",
        "passed": vos_with_value >= 2,
        "evidence": f"{vos_with_value}/{len(vo_names)} VOs use @Value"
    })

    # 5. domain_event_interface_reused
    reuses_event = file_contains(files, r"import\s+com\.example\.orders\.domain\.DomainEvent")
    creates_new = any_file_named(files, "DomainEvent.java")
    results.append({
        "text": "domain_event_interface_reused",
        "passed": reuses_event and not creates_new,
        "evidence": f"imports existing DomainEvent: {reuses_event}, creates new: {creates_new}"
    })

    # 6. pending_events_pattern
    shipment = file_content(files, "Shipment.java")
    has_pending = "pendingEvents" in shipment or "pending_events" in shipment
    has_flush = "flushEvents" in shipment or "flush" in shipment.lower()
    results.append({
        "text": "pending_events_pattern",
        "passed": has_pending and has_flush,
        "evidence": f"pendingEvents: {has_pending}, flushEvents: {has_flush}"
    })

    # 7. all_building_blocks_present
    expected = ["Shipment", "ShipmentId", "ShippingAddress", "TrackingNumber",
                "ShipmentCreated", "ShipmentDispatched", "ShipmentRepository", "ShipmentStatus"]
    found = [e for e in expected if any(e in n for n in files)]
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) == len(expected),
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. business_rules_enforced
    shipment = file_content(files, "Shipment.java")
    # Check tracking number guard in dispatch(): look for null check or any conditional on trackingNumber
    has_tracking_check = ("trackingNumber" in shipment and
                          ("null" in shipment or "== null" in shipment or "!= null" in shipment
                           or "hasTracking" in shipment or "assigned" in shipment.lower()
                           or "tracking number" in shipment.lower()))
    # Check status guard: delivered/dispatched status checks
    has_status_check = ("DELIVERED" in shipment or "Delivered" in shipment) and ("throw" in shipment or "Exception" in shipment)
    results.append({
        "text": "business_rules_enforced",
        "passed": has_tracking_check and has_status_check,
        "evidence": f"tracking check: {has_tracking_check}, status check: {has_status_check}"
    })

    # 9. orderid_reused_not_recreated
    imports_orderid = file_contains(files, r"import\s+com\.example\.orders\.domain\.OrderId")
    creates_orderid = any_file_named(files, "OrderId.java")
    results.append({
        "text": "orderid_reused_not_recreated",
        "passed": imports_orderid and not creates_orderid,
        "evidence": f"imports OrderId: {imports_orderid}, creates new: {creates_orderid}"
    })

    return results


# --- Eval 2: Pricing Plain Java ---

def grade_pricing(files: dict[str, str]) -> list[dict]:
    results = []

    # 1. correct_package_placement
    has_pricing_pkg = file_contains(files, r"package\s+pl\.shop\.catalog\.pricing")
    results.append({
        "text": "correct_package_placement",
        "passed": has_pricing_pkg,
        "evidence": f"pricing package: {has_pricing_pkg}"
    })

    # 2. service_per_use_case_pattern
    service_files = [n for n in files if "Service" in n]
    has_multiple_services = len(service_files) >= 2
    results.append({
        "text": "service_per_use_case_pattern",
        "passed": has_multiple_services,
        "evidence": f"service files: {service_files}"
    })

    # 3. vavr_either_returns
    has_either = file_contains(files, r"Either<String,\s*\w+>") or file_contains(files, r"Either<String,\w+>")
    has_vavr_import = file_contains(files, r"import\s+io\.vavr")
    results.append({
        "text": "vavr_either_returns",
        "passed": has_either and has_vavr_import,
        "evidence": f"Either returns: {has_either}, Vavr import: {has_vavr_import}"
    })

    # 4. no_lombok_used
    has_lombok = file_contains(files, r"import\s+lombok")
    results.append({
        "text": "no_lombok_used",
        "passed": not has_lombok,
        "evidence": f"lombok imports found: {has_lombok}"
    })

    # 5. money_reused_not_recreated
    imports_money = file_contains(files, r"import\s+pl\.shop\.catalog\.Money")
    creates_money = any_file_named(files, "Money.java")
    results.append({
        "text": "money_reused_not_recreated",
        "passed": imports_money and not creates_money,
        "evidence": f"imports Money: {imports_money}, creates new: {creates_money}"
    })

    # 6. productid_reused_not_recreated
    imports_pid = file_contains(files, r"import\s+pl\.shop\.catalog\.ProductId")
    creates_pid = any_file_named(files, "ProductId.java")
    results.append({
        "text": "productid_reused_not_recreated",
        "passed": imports_pid and not creates_pid,
        "evidence": f"imports ProductId: {imports_pid}, creates new: {creates_pid}"
    })

    # 7. all_building_blocks_present
    expected = ["PriceList", "PriceListId", "PriceEntry", "Discount",
                "PricingService", "DiscountApplied", "PriceListActivated"]
    # Money already exists, so 7 new classes expected
    found = [e for e in expected if any(e in n for n in files)]
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) >= 6,
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. discount_percentage_validation
    discount = file_content(files, "Discount.java")
    has_validation = ("100" in discount or "percent" in discount.lower()) and ("throw" in discount or "left" in discount)
    results.append({
        "text": "discount_percentage_validation",
        "passed": has_validation,
        "evidence": f"validation in Discount: {has_validation}"
    })

    # 9. package_private_internals
    price_entry = file_content(files, "PriceEntry.java")
    is_package_private = price_entry and "public class PriceEntry" not in price_entry
    results.append({
        "text": "package_private_internals",
        "passed": is_package_private,
        "evidence": f"PriceEntry package-private: {is_package_private}"
    })

    return results


# --- Eval 3: Transfers Records Modern ---

def grade_transfers(files: dict[str, str]) -> list[dict]:
    results = []

    # 1. correct_package_placement
    has_transfers_pkg = file_contains(files, r"package\s+dev\.app\.banking\.transfers")
    results.append({
        "text": "correct_package_placement",
        "passed": has_transfers_pkg,
        "evidence": f"transfers package: {has_transfers_pkg}"
    })

    # 2. command_handler_pattern
    cmd_files = [n for n in files if "Command" in n and "Transfer" in n]
    handler_files = [n for n in files if "Handler" in n and "Transfer" in n]
    has_implements_command = file_contains(files, r"implements\s+Command<")
    has_implements_handler = file_contains(files, r"implements\s+CommandHandler<")
    results.append({
        "text": "command_handler_pattern",
        "passed": len(cmd_files) >= 1 and len(handler_files) >= 1 and has_implements_command and has_implements_handler,
        "evidence": f"commands: {cmd_files}, handlers: {handler_files}, implements: cmd={has_implements_command}, handler={has_implements_handler}"
    })

    # 3. records_for_value_objects
    transfer_id = file_content(files, "TransferId.java")
    is_record = "record TransferId" in transfer_id
    results.append({
        "text": "records_for_value_objects",
        "passed": is_record,
        "evidence": f"TransferId is record: {is_record}"
    })

    # 4. sealed_event_interface
    transfer = file_content(files, "Transfer.java")
    has_sealed = "sealed" in transfer and "Event" in transfer and "permits" in transfer
    results.append({
        "text": "sealed_event_interface",
        "passed": has_sealed,
        "evidence": f"sealed Event interface: {has_sealed}"
    })

    # 5. accountid_reused_not_recreated
    imports_aid = file_contains(files, r"import\s+dev\.app\.banking\.accounts\.AccountId")
    creates_aid = any_file_named(files, "AccountId.java")
    results.append({
        "text": "accountid_reused_not_recreated",
        "passed": imports_aid and not creates_aid,
        "evidence": f"imports AccountId: {imports_aid}, creates new: {creates_aid}"
    })

    # 6. amount_reused_not_recreated
    imports_amount = file_contains(files, r"import\s+dev\.app\.banking\.accounts\.Amount")
    creates_amount = any_file_named(files, "Amount.java")
    results.append({
        "text": "amount_reused_not_recreated",
        "passed": imports_amount and not creates_amount,
        "evidence": f"imports Amount: {imports_amount}, creates new: {creates_amount}"
    })

    # 7. all_building_blocks_present
    expected = ["Transfer", "TransferId", "TransferStatus",
                "TransferInitiated", "TransferCompleted", "TransferRepository"]
    # AccountId and Amount already exist
    # Check both filenames AND class/record definitions inside files (for inner records)
    all_content = " ".join(files.values())
    found = []
    for e in expected:
        if any(e in n for n in files):
            found.append(e)
        elif re.search(rf"\b(class|record|interface|enum)\s+{e}\b", all_content):
            found.append(e + " (inner)")
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) >= 5,
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. same_account_validation
    transfer = file_content(files, "Transfer.java")
    all_content = " ".join(files.values())
    has_same_check = ("source" in all_content.lower() and "destination" in all_content.lower()
                      and ("equals" in all_content or "==" in all_content or "same" in all_content.lower()))
    results.append({
        "text": "same_account_validation",
        "passed": has_same_check,
        "evidence": f"same-account validation: {has_same_check}"
    })

    # 9. modern_java_features
    has_var = file_contains(files, r"\bvar\s+\w+")
    has_record = file_contains(files, r"\brecord\s+\w+")
    results.append({
        "text": "modern_java_features",
        "passed": has_var and has_record,
        "evidence": f"var: {has_var}, record: {has_record}"
    })

    return results


def grade_run(eval_name: str, output_dir: str) -> list[dict]:
    files = read_all_java(output_dir)
    if not files:
        return [{"text": f"no_files_found", "passed": False, "evidence": f"No .java files in {output_dir}"}]

    if "shipping" in eval_name:
        return grade_shipping(files)
    elif "pricing" in eval_name:
        return grade_pricing(files)
    elif "transfers" in eval_name:
        return grade_transfers(files)
    else:
        return [{"text": "unknown_eval", "passed": False, "evidence": f"Unknown eval: {eval_name}"}]


def main():
    if len(sys.argv) < 3:
        print("Usage: grade_eval.py <eval_name> <output_dir>")
        sys.exit(1)

    eval_name = sys.argv[1]
    output_dir = sys.argv[2]

    results = grade_run(eval_name, output_dir)

    passed = sum(1 for r in results if r["passed"])
    total = len(results)

    grading = {
        "eval_name": eval_name,
        "output_dir": output_dir,
        "pass_rate": f"{passed}/{total}",
        "expectations": results
    }

    # Write grading.json next to output dir
    grading_path = Path(output_dir).parent / "grading.json"
    with open(grading_path, "w") as f:
        json.dump(grading, f, indent=2)

    print(json.dumps(grading, indent=2))


if __name__ == "__main__":
    main()
