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


# --- Eval 4: Payroll Mixed Patterns ---

def grade_payroll(files: dict[str, str]) -> list[dict]:
    results = []
    all_content = " ".join(files.values())

    # 1. correct_package_placement
    has_payroll_pkg = file_contains(files, r"package\s+com\.acme\.hr\.payroll")
    results.append({
        "text": "correct_package_placement",
        "passed": has_payroll_pkg,
        "evidence": f"payroll package: {has_payroll_pkg}"
    })

    # 2. uses_rich_model_not_anemic — KEY DISCRIMINATOR
    # Should follow leave module style (Either returns, immutable VOs, private constructors)
    # NOT employees style (getters/setters, exceptions, mutable)
    payroll_run = file_content(files, "PayrollRun.java")
    has_either = file_contains(files, r"Either<String,\s*\w+>") or file_contains(files, r"Either<String,\w+>")
    has_vavr = file_contains(files, r"import\s+io\.vavr")
    has_no_setters = "void set" not in payroll_run
    results.append({
        "text": "uses_rich_model_not_anemic",
        "passed": has_either and has_vavr and has_no_setters,
        "evidence": f"Either: {has_either}, Vavr import: {has_vavr}, no setters: {has_no_setters}"
    })

    # 3. immutable_value_objects — KEY DISCRIMINATOR
    # Salary should be final class with private constructor (leave style) not mutable bean (employees style)
    salary = file_content(files, "Salary.java")
    is_final_or_record = "final class Salary" in salary or "record Salary" in salary
    has_no_setter = "void set" not in salary
    results.append({
        "text": "immutable_value_objects",
        "passed": is_final_or_record and has_no_setter,
        "evidence": f"final/record: {is_final_or_record}, no setters: {has_no_setter}"
    })

    # 4. service_per_use_case — KEY DISCRIMINATOR
    # Should follow leave style (SubmitLeaveService, ApproveLeaveService) not EmployeeService (god service)
    service_files = [n for n in files if "Service" in n]
    has_specific_services = len(service_files) >= 1
    # Should NOT have a god service like "PayrollService" doing everything
    has_god_service = any("PayrollService.java" == n for n in files)
    results.append({
        "text": "service_per_use_case",
        "passed": has_specific_services and not has_god_service,
        "evidence": f"services: {service_files}, god service: {has_god_service}"
    })

    # 5. domain_application_layer_split
    has_domain = file_contains(files, r"package\s+com\.acme\.hr\.payroll\.domain")
    has_app = file_contains(files, r"package\s+com\.acme\.hr\.payroll\.application")
    results.append({
        "text": "domain_application_layer_split",
        "passed": has_domain and has_app,
        "evidence": f"domain pkg: {has_domain}, application pkg: {has_app}"
    })

    # 6. employeeid_reused
    imports_eid = file_contains(files, r"import\s+com\.acme\.hr\.employees\.EmployeeId")
    creates_eid = any_file_named(files, "EmployeeId.java")
    results.append({
        "text": "employeeid_reused",
        "passed": imports_eid and not creates_eid,
        "evidence": f"imports EmployeeId: {imports_eid}, creates new: {creates_eid}"
    })

    # 7. all_building_blocks_present
    expected = ["PayrollRun", "PayrollRunId", "PayrollStatus", "Salary",
                "Payslip", "PayrollExecuted", "PayrollRunRepository"]
    found = [e for e in expected if any(e in n for n in files) or
             re.search(rf"\b(class|record|interface|enum)\s+{e}\b", all_content)]
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) >= 6,
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. payslip_package_private — entity within aggregate
    payslip = file_content(files, "Payslip.java")
    is_pkg_private = payslip and "public class Payslip" not in payslip
    results.append({
        "text": "payslip_package_private",
        "passed": is_pkg_private,
        "evidence": f"Payslip package-private: {is_pkg_private}"
    })

    # 9. business_rules_enforced
    payroll_run = file_content(files, "PayrollRun.java")
    has_empty_check = "empty" in payroll_run.lower() or "payslips" in payroll_run.lower()
    has_executed_guard = "EXECUTED" in payroll_run or "Executed" in payroll_run
    results.append({
        "text": "business_rules_enforced",
        "passed": has_empty_check and has_executed_guard,
        "evidence": f"empty check: {has_empty_check}, executed guard: {has_executed_guard}"
    })

    return results


# --- Eval 5: Order Extended (Delta) ---

def grade_order_delta(files: dict[str, str]) -> list[dict]:
    results = []
    all_content = " ".join(files.values())

    # 1. order_modified_not_recreated — KEY DISCRIMINATOR
    # Order.java should be in outputs but should EXTEND existing, not start from scratch
    order = file_content(files, "Order.java")
    has_order = bool(order)
    # Must have BOTH old methods (addLine, place, total) AND new ones (cancel, applyDiscount)
    has_old_methods = "addLine" in order and "place" in order and "total()" in order
    has_new_methods = "cancel" in order and "applyDiscount" in order
    results.append({
        "text": "order_modified_not_recreated",
        "passed": has_order and has_old_methods and has_new_methods,
        "evidence": f"has Order: {has_order}, old methods: {has_old_methods}, new methods: {has_new_methods}"
    })

    # 2. status_enum_extended — KEY DISCRIMINATOR
    # Status enum should have CANCELLED added to existing DRAFT, PLACED
    has_cancelled = "CANCELLED" in order or "Cancelled" in order
    has_draft = "DRAFT" in order or "Draft" in order
    has_placed = "PLACED" in order or "Placed" in order
    results.append({
        "text": "status_enum_extended",
        "passed": has_cancelled and has_draft and has_placed,
        "evidence": f"CANCELLED: {has_cancelled}, DRAFT: {has_draft}, PLACED: {has_placed}"
    })

    # 3. new_fields_added
    has_shipping = "shippingAddress" in order or "shipping_address" in order.lower()
    has_discount = "discountCode" in order or "discount" in order.lower()
    results.append({
        "text": "new_fields_added",
        "passed": has_shipping and has_discount,
        "evidence": f"shippingAddress: {has_shipping}, discountCode: {has_discount}"
    })

    # 4. new_vo_classes_created
    has_discount_code = any_file_named(files, "DiscountCode.java")
    has_shipping_addr = any_file_named(files, "ShippingAddress.java")
    results.append({
        "text": "new_vo_classes_created",
        "passed": has_discount_code and has_shipping_addr,
        "evidence": f"DiscountCode: {has_discount_code}, ShippingAddress: {has_shipping_addr}"
    })

    # 5. discount_validation
    discount_code = file_content(files, "DiscountCode.java")
    has_pct_validation = "100" in discount_code and ("throw" in discount_code or "left" in discount_code)
    results.append({
        "text": "discount_validation",
        "passed": has_pct_validation,
        "evidence": f"percentage validation: {has_pct_validation}"
    })

    # 6. shipping_address_validation
    shipping = file_content(files, "ShippingAddress.java")
    has_addr_validation = shipping and ("street" in shipping and ("blank" in shipping.lower() or "null" in shipping or "empty" in shipping.lower()))
    results.append({
        "text": "shipping_address_validation",
        "passed": bool(has_addr_validation),
        "evidence": f"address validation: {has_addr_validation}"
    })

    # 7. cancel_rule_enforced — only placed orders
    has_cancel_guard = "cancel" in order and ("PLACED" in order or "Placed" in order or "isPlaced" in order)
    results.append({
        "text": "cancel_rule_enforced",
        "passed": has_cancel_guard,
        "evidence": f"cancel only-placed guard: {has_cancel_guard}"
    })

    # 8. order_cancelled_event
    has_event = any_file_named(files, "OrderCancelled.java") or "OrderCancelled" in all_content
    results.append({
        "text": "order_cancelled_event",
        "passed": has_event,
        "evidence": f"OrderCancelled event: {has_event}"
    })

    # 9. cancel_order_service
    has_cancel_service = any_file_named(files, "CancelOrderService.java")
    results.append({
        "text": "cancel_order_service",
        "passed": has_cancel_service,
        "evidence": f"CancelOrderService: {has_cancel_service}"
    })

    # 10. existing_types_not_duplicated — KEY DISCRIMINATOR
    # Should NOT create OrderId, CustomerId, Money in a DIFFERENT package
    # Copying them to outputs in the SAME package (org.store.orders.domain) is OK
    original_pkg = "org.store.orders.domain"
    duplicated = []
    for name in ["OrderId.java", "CustomerId.java", "Money.java"]:
        content = file_content(files, name)
        if content:
            # Check if it's in the original package (OK) or a different one (BAD)
            if original_pkg not in content:
                duplicated.append(name)
    results.append({
        "text": "existing_types_not_duplicated",
        "passed": len(duplicated) == 0,
        "evidence": f"duplicated in wrong package: {duplicated}" if duplicated else "all existing types in correct package or not emitted"
    })

    # 11. records_style_preserved — new VOs should use records like existing project
    discount_code = file_content(files, "DiscountCode.java")
    shipping = file_content(files, "ShippingAddress.java")
    dc_is_record = "record DiscountCode" in discount_code
    sa_is_record = "record ShippingAddress" in shipping
    results.append({
        "text": "records_style_preserved",
        "passed": dc_is_record and sa_is_record,
        "evidence": f"DiscountCode record: {dc_is_record}, ShippingAddress record: {sa_is_record}"
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
    elif "payroll" in eval_name:
        return grade_payroll(files)
    elif "order-delta" in eval_name or "order_delta" in eval_name:
        return grade_order_delta(files)
    elif "receiving" in eval_name:
        return grade_receiving(files)
    elif "returns" in eval_name:
        return grade_returns(files)
    else:
        return [{"text": "unknown_eval", "passed": False, "evidence": f"Unknown eval: {eval_name}"}]


# --- Eval 6: Receiving (Unusual Conventions) ---

def grade_receiving(files: dict[str, str]) -> list[dict]:
    results = []
    all_content = " ".join(files.values())

    # 1. correct_package
    has_receiving_pkg = file_contains(files, r"package\s+io\.proj\.warehouse\.receiving")
    results.append({
        "text": "correct_package_placement",
        "passed": has_receiving_pkg,
        "evidence": f"receiving package: {has_receiving_pkg}"
    })

    # 2. sealed_events_in_separate_file — KEY DISCRIMINATOR
    # Project uses InventoryEvents.java as a separate sealed interface file
    # New module should have ReceivingEvents.java (or similar), NOT inner records
    event_files = [n for n in files if "Event" in n and "Receiving" in n]
    has_sealed_events_file = len(event_files) > 0
    has_sealed_keyword = False
    for ef in event_files:
        if "sealed" in file_content(files, ef):
            has_sealed_keyword = True
    results.append({
        "text": "sealed_events_in_separate_file",
        "passed": has_sealed_events_file and has_sealed_keyword,
        "evidence": f"event files: {event_files}, sealed: {has_sealed_keyword}"
    })

    # 3. repository_as_nested_interface — KEY DISCRIMINATOR
    # Project uses InventoryItem.Repository as nested interface
    receiving_note = file_content(files, "ReceivingNote.java")
    has_nested_repo = "interface Repository" in receiving_note
    results.append({
        "text": "repository_as_nested_interface",
        "passed": has_nested_repo,
        "evidence": f"nested Repository interface in ReceivingNote: {has_nested_repo}"
    })

    # 4. factory_as_inner_class — KEY DISCRIMINATOR
    # Project uses InventoryItem.Factory as static inner class
    has_nested_factory = "class Factory" in receiving_note or "static class Factory" in receiving_note
    results.append({
        "text": "factory_as_inner_class",
        "passed": has_nested_factory,
        "evidence": f"nested Factory in ReceivingNote: {has_nested_factory}"
    })

    # 5. sku_reused
    imports_sku = file_contains(files, r"import\s+io\.proj\.warehouse\.inventory\.Sku")
    creates_sku = any_file_named(files, "Sku.java")
    results.append({
        "text": "sku_reused",
        "passed": imports_sku and not creates_sku,
        "evidence": f"imports Sku: {imports_sku}, creates new: {creates_sku}"
    })

    # 6. quantity_reused
    imports_qty = file_contains(files, r"import\s+io\.proj\.warehouse\.inventory\.Quantity")
    creates_qty = any_file_named(files, "Quantity.java")
    results.append({
        "text": "quantity_reused",
        "passed": imports_qty and not creates_qty,
        "evidence": f"imports Quantity: {imports_qty}, creates new: {creates_qty}"
    })

    # 7. all_building_blocks
    expected = ["ReceivingNote", "ReceivingNoteId", "ReceivedLine", "ReceivingStatus",
                "ReceivingFinalized", "FinalizeReceivingHandler"]
    found = [e for e in expected if any(e in n for n in files) or
             re.search(rf"\b(class|record|interface|enum)\s+{e}\b", all_content)]
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) >= 5,
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. received_line_package_private
    received_line = file_content(files, "ReceivedLine.java")
    is_pkg_private = received_line and "public class ReceivedLine" not in received_line and "public record ReceivedLine" not in received_line
    results.append({
        "text": "received_line_package_private",
        "passed": bool(is_pkg_private),
        "evidence": f"ReceivedLine package-private: {is_pkg_private}"
    })

    # 9. business_rules_enforced
    rn = file_content(files, "ReceivingNote.java")
    has_empty_check = "empty" in rn.lower() or "lines" in rn.lower()
    has_finalized_guard = "FINALIZED" in rn or "Finalized" in rn
    results.append({
        "text": "business_rules_enforced",
        "passed": has_empty_check and has_finalized_guard,
        "evidence": f"empty check: {has_empty_check}, finalized guard: {has_finalized_guard}"
    })

    return results


# --- Eval 7: Returns (Cross-Module) ---

def grade_returns(files: dict[str, str]) -> list[dict]:
    results = []
    all_content = " ".join(files.values())

    # 1. return_request_in_sales — KEY DISCRIMINATOR
    has_sales_pkg = file_contains(files, r"package\s+net\.ecom\.sales\.returns")
    results.append({
        "text": "return_request_in_sales_package",
        "passed": has_sales_pkg,
        "evidence": f"sales.returns package: {has_sales_pkg}"
    })

    # 2. return_receipt_in_fulfillment — KEY DISCRIMINATOR
    has_fulfillment_pkg = file_contains(files, r"package\s+net\.ecom\.fulfillment")
    results.append({
        "text": "return_receipt_in_fulfillment_package",
        "passed": has_fulfillment_pkg,
        "evidence": f"fulfillment package: {has_fulfillment_pkg}"
    })

    # 3. sealed_events_per_aggregate — match project pattern
    # Each aggregate should have its own sealed Event interface
    has_return_request_events = "sealed" in all_content and "ReturnRequested" in all_content
    has_return_receipt_events = "sealed" in all_content and "ReturnReceived" in all_content
    results.append({
        "text": "sealed_events_pattern",
        "passed": has_return_request_events and has_return_receipt_events,
        "evidence": f"ReturnRequest events: {has_return_request_events}, ReturnReceipt events: {has_return_receipt_events}"
    })

    # 4. repository_as_nested_interface — match project pattern
    return_request = file_content(files, "ReturnRequest.java")
    return_receipt = file_content(files, "ReturnReceipt.java")
    rr_nested_repo = "interface Repository" in return_request
    rc_nested_repo = "interface Repository" in return_receipt
    results.append({
        "text": "repository_as_nested_interface",
        "passed": rr_nested_repo and rc_nested_repo,
        "evidence": f"ReturnRequest.Repository: {rr_nested_repo}, ReturnReceipt.Repository: {rc_nested_repo}"
    })

    # 5. orderid_reused_from_shared
    imports_orderid = file_contains(files, r"import\s+net\.ecom\.sales\.shared\.OrderId")
    creates_orderid = any_file_named(files, "OrderId.java")
    results.append({
        "text": "orderid_reused_from_shared",
        "passed": imports_orderid and not creates_orderid,
        "evidence": f"imports OrderId: {imports_orderid}, creates new: {creates_orderid}"
    })

    # 6. money_reused_from_shared
    imports_money = file_contains(files, r"import\s+net\.ecom\.sales\.shared\.Money")
    creates_money = any_file_named(files, "Money.java")
    results.append({
        "text": "money_reused_from_shared",
        "passed": imports_money and not creates_money,
        "evidence": f"imports Money: {imports_money}, creates new: {creates_money}"
    })

    # 7. all_building_blocks
    expected = ["ReturnRequest", "ReturnRequestId", "ReturnRequested",
                "ReturnReceipt", "ReturnReceiptId", "ReturnReceived"]
    found = [e for e in expected if any(e in n for n in files) or
             re.search(rf"\b(class|record|interface|enum)\s+{e}\b", all_content)]
    results.append({
        "text": "all_building_blocks_present",
        "passed": len(found) >= 5,
        "evidence": f"found {len(found)}/{len(expected)}: {found}"
    })

    # 8. cross_module_reference — ReturnReceipt references ReturnRequestId from sales
    receipt_content = file_content(files, "ReturnReceipt.java")
    has_cross_ref = "ReturnRequestId" in receipt_content
    results.append({
        "text": "cross_module_reference",
        "passed": has_cross_ref,
        "evidence": f"ReturnReceipt references ReturnRequestId: {has_cross_ref}"
    })

    # 9. return_status
    has_status = "ReturnStatus" in all_content
    results.append({
        "text": "return_status_present",
        "passed": has_status,
        "evidence": f"ReturnStatus: {has_status}"
    })

    return results


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
