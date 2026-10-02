# Guesty Open API – recorded shapes

Probe run: 2026-10-02T20:40:54.530Z

## listings-page

```json
{
  "results": [
    {
      "_id": "68592546458130001380dfc6",
      "tags": [
        "pet friendly",
        "…2 items"
      ],
      "active": true,
      "title": "Luxury with Danube River View",
      "bedrooms": 1,
      "bathrooms": 1,
      "beds": 1,
      "isListed": true,
      "address": {
        "city": "Bratislava"
      },
      "accommodates": 2,
      "accountId": "682f39ceca0d576ff1aa1da7",
      "nickname": "Pribinová, Luxury",
      "listingRooms": [
        {
          "_id": "685925470625233b4d4db3f7",
          "roomNumber": 0,
          "beds": [
            "{…}",
            "…1 items"
          ]
        },
        "…4 items"
      ],
      "customFields": [
        {
          "_id": "68b02b6e430969f635096eb5",
          "fieldId": "68b02510298d540010a4d3cf",
          "value": "LIVE-IN International"
        },
        "…5 items"
      ]
    },
    "…5 items"
  ],
  "title": "Listings Report",
  "fields": "_id nickname title active isListed addre…",
  "limit": 5,
  "skip": 0,
  "count": 132
}
```

## listing counts

- no filter: count=132
- active=true&listed=true: count=131

## listing-detail

```json
{
  "_id": "68592546458130001380dfc6",
  "type": "SINGLE",
  "tags": [
    "pet friendly",
    "…2 items"
  ],
  "active": true,
  "title": "Luxury with Danube River View",
  "bedrooms": 1,
  "bathrooms": 1,
  "beds": 1,
  "isListed": true,
  "address": {
    "city": "Bratislava"
  },
  "accommodates": 2,
  "accountId": "682f39ceca0d576ff1aa1da7",
  "nickname": "Pribinová, Luxury",
  "listingRooms": [
    {
      "_id": "685925470625233b4d4db3f7",
      "roomNumber": 0,
      "beds": [
        {
          "_id": "69414debdd24da0014e4c47b",
          "type": "KING_BED",
          "quantity": 1
        },
        "…1 items"
      ]
    },
    "…4 items"
  ],
  "customFields": [
    {
      "_id": "68b02b6e430969f635096eb5",
      "fieldId": "68b02510298d540010a4d3cf",
      "value": "LIVE-IN International"
    },
    "…5 items"
  ],
  "financials": {
    "channelCommission": {
      "_id": "699877e3ef80e5a81706bb1e",
      "accountId": "682f39ceca0d576ff1aa1da7",
      "unitTypeId": "68592546458130001380dfc6",
      "createdAt": "2026-02-20T15:04:03.969Z",
      "updatedAt": "2026-02-20T15:04:08.200Z",
      "__v": 0,
      "useAccountSettings": true,
      "manual": []
    }
  }
}
```

## spaces

```json
{
  "unitTypeId": "68592546458130001380dfc6",
  "bedroomsAllowed": true,
  "bathrooms": 1,
  "spaces": [
    {
      "_id": "685925470625233b4d4db3f7",
      "unitTypeId": "68592546458130001380dfc6",
      "accountId": "682f39ceca0d576ff1aa1da7",
      "name": "Bedroom",
      "type": "BEDROOM",
      "roomNumber": 0,
      "isPrivate": true,
      "beds": {
        "KING_BED": 1,
        "QUEEN_BED": 0,
        "DOUBLE_BED": 0,
        "SINGLE_BED": 0,
        "SOFA_BED": 0,
        "AIR_MATTRESS": 0,
        "BUNK_BED": 0
      },
      "other": {
        "FLOOR_MATTRESS": 0,
        "WATER_BED": 0,
        "TODDLER_BED": 0,
        "CRIB": 0
      },
      "__v": 0
    },
    "…4 items"
  ]
}
```

## property-custom-fields

```json
{
  "propertyId": "68592546458130001380dfc6",
  "customFields": [
    {
      "fieldId": "68b02510298d540010a4d3cf",
      "displayName": "company_name",
      "key": "Company name",
      "type": "text",
      "options": [],
      "object": "listing",
      "isPublic": true,
      "value": "LIVE-IN International"
    },
    "…5 items"
  ]
}
```

## custom-field-defs

```json
[
  {
    "fieldId": "68b02510298d540010a4d3cf",
    "options": [],
    "key": "Company name",
    "isPublic": true,
    "displayName": "company_name",
    "object": "listing",
    "type": "text"
  },
  "…10 items"
]
```

## reservations-search

```json
{
  "results": [
    {
      "reservationId": "6aa516eb4b0afa5c8ca1c984",
      "confirmationCode": "BC-7JZlLjWo8",
      "status": "confirmed",
      "guestId": "6aa516ebba6fa144e0efbb58",
      "checkIn": "2026-09-20T16:00:00.000Z",
      "checkOut": "2026-10-02T11:00:00.000Z",
      "checkInDateLocalized": "2026-09-20",
      "checkOutDateLocalized": "2026-10-02",
      "source": "Booking.com",
      "channel": "bookingCom",
      "createdAt": "2026-09-12T09:10:03.751Z",
      "bookingDate": "2026-09-12T09:08:31.000Z",
      "notes": {},
      "stay": [
        {
          "listingId": "6a2befa5ed0c9600117d7e48",
          "checkIn": "2026-09-20T16:00:00.000Z",
          "checkOut": "2026-10-02T11:00:00.000Z",
          "checkInDateLocalized": "2026-09-20",
          "checkOutDateLocalized": "2026-10-02",
          "guestsCount": 1,
          "numberOfGuests": "{…}"
        },
        "…1 items"
      ],
      "guestStay": {
        "status": "not_set",
        "createdAt": "2026-09-12T09:10:03.774Z",
        "updatedAt": "2026-09-12T09:10:03.774Z"
      },
      "unifiedId": "v1-682f39ceca0d576ff1aa1da7-BC-7JZlLjWo8",
      "channelMetadata": {
        "externalReservationId": "5013632800",
        "externalListingId": "1664297302",
        "createdAt": "2026-09-12T09:08:31.000Z",
        "hotelId": "16642973",
        "stayId": "484",
        "loyaltyProgram": "genius",
        "isGroupReservation": false,
        "isFullReservationData": true,
        "ratePlan": {
          "id": "66319492",
          "name": "Smart Non-Refundable",
          "childId": "0"
        },
        "guestPreferences": {
          "smoking": false
        }
      }
    },
    "…5 items"
  ],
  "pagination": {
    "skip": 0,
    "limit": 5,
    "hasMore": true
  }
}
```

## reservations-by-ids

```json
[
  {
    "_id": "6aa516eb4b0afa5c8ca1c984",
    "accountId": "682f39ceca0d576ff1aa1da7",
    "bookerId": "6aa516ebba6fa144e0efbb58",
    "bookingDate": "2026-09-12T09:08:31.000Z",
    "channelMetadata": {
      "externalReservationId": "5013632800",
      "externalListingId": "1664297302",
      "createdAt": "2026-09-12T09:08:31.000Z",
      "hotelId": "16642973",
      "stayId": "484",
      "loyaltyProgram": "genius",
      "isGroupReservation": false,
      "isFullReservationData": true,
      "ratePlan": {
        "id": "66319492",
        "name": "Smart Non-Refundable",
        "childId": "0"
      }
    },
    "channelsSyncState": {
      "listing": {
        "syncMode": "ENABLED",
        "unlockOnListingId": "6a2befa5ed0c9600117d7e48"
      }
    },
    "confirmationCode": "BC-7JZlLjWo8",
    "confirmedAt": "2026-09-12T09:08:31.000Z",
    "conversationExternalId": "7a96a9fb-8950-52a4-833d-cd08608b45c4",
    "createdAt": "2026-09-12T09:10:03.751Z",
    "guestPreferences": {
      "smoking": false
    },
    "guestStay": {
      "status": "not_set",
      "createdAt": "2026-09-12T09:10:03.774Z",
      "updatedAt": "2026-09-12T09:10:03.774Z"
    },
    "guests": [
      {
        "id": "6aa516ebba6fa144e0efbb58",
        "type": "adult"
      },
      "…1 items"
    ],
    "integrationId": "68930b0bb05259001262eaa3",
    "isUsingVCC": false,
    "moneyId": "6aa516eb52cf6521dc5854e6",
    "platform": "bookingCom",
    "ratePlans": [
      {
        "ratePlanId": "692570b6e67a91cd18ff3941",
        "name": "Smart Non-Refundable",
        "mealPlan": "There is no meal option with this room.",
        "cancellationPolicy": "NON_REFUNDABLE",
        "cancellationPolicyDescription": "The guest will be charged the total pric…",
        "cancellationFee": 100,
        "promotionData": {
          "_id": "684fd344a7e1c776216a0afe",
          "name": "Mobile Rate",
          "externalPromotionId": "MR"
        }
      },
      "…1 items"
    ],
    "source": "Booking.com",
    "status": "confirmed",
    "stay": [
      {
        "checkInDateLocalized": "2026-09-20",
        "checkOutDateLocalized": "2026-10-02",
        "guestsCount": 1,
        "numberOfGuests": {
          "numberOfAdults": 1,
          "numberOfChildren": 0,
          "numberOfInfants": 0
        },
        "unitTypeId": "6a2befa5ed0c9600117d7e48",
        "unitId": "6a2befa5ed0c9600117d7e48",
        "eta": "2026-09-20T16:00:00.000Z",
        "etd": "2026-10-02T11:00:00.000Z"
      },
      "…1 items"
    ],
    "unifiedId": "v1-682f39ceca0d576ff1aa1da7-BC-7JZlLjWo8",
    "conversationId": "6aa516ec4635e00012a114b9",
    "money": {
      "_id": "6aa516eb52cf6521dc5854e6",
      "reservationId": "6aa516eb4b0afa5c8ca1c984",
      "listingId": "6a2befa5ed0c9600117d7e48",
      "accountId": "682f39ceca0d576ff1aa1da7",
      "invoiceItems": [
        {
          "title": "Cleaning fee",
          "amount": 38,
          "baseAmount": 38,
          "currency": "EUR",
          "isLocked": true,
          "type": "CLEANING_FEE",
          "normalType": "CF",
          "refId": "e83279ab-b363-4c5e-b557-577c8e2af51b",
          "origin": "CHANNEL",
          "internalIndex": 0,
          "originalGrosses": "{…}",
          "_id": "5e54e339ac76ed0028128b9b"
        },
        "…5 items"
      ],
      "channelInvoiceItems": [
        {
          "_id": "5e54e339ac76ed0028128b9b",
          "name": "cleaning fee",
          "type": "CLEANING_FEE",
          "title": "Cleaning fee",
          "normalType": "CF",
          "channel": "Booking",
          "currency": "EUR",
          "amount": 38,
          "isLocked": true,
          "origin": "CHANNEL"
        },
        "…5 items"
      ],
      "nightlyRateInvoiceItems": [
        {
          "_id": "6aa516eb52cf6521dc5854d9",
          "adjustments": [],
          "includedAdjustments": [],
          "internalIndex": 0,
          "isCalculatedByGuesty": false,
          "nightsBreakdown": [
            "{…}",
            "…12 items"
          ],
          "normalType": "AF",
          "origin": "CHANNEL",
          "refId": "32014dd4-fb6e-40a2-994f-b296cf82df03",
          "taxesData": "{…}",
          "title": "Accommodation fare",
          "totalNightsPrice": 640.28,
          "totalPrice": 640.28
        },
        "…5 items"
      ],
      "currency": "EUR",
      "platform": "bookingCom",
      "source": "Booking.com",
      "fareAccommodationAdjustment": 0,
      "fareAccommodationDiscount": 0,
      "fareAccommodation": 640.28,
      "fareAccommodationAdjusted": 736.32,
      "fareAccommodationBundleFeesApplied": 0,
      "fareCleaning": 38,
      "hostServiceFee": 97.34,
      "hostServiceFeeTax": 0,
      "hostServiceFeeIncTax": 97.34,
      "subTotalPrice": 774.32,
      "hostPayout": 853.14,
      "hostPayoutUsd": 989.81,
      "totalTaxes": 78.82,
      "totalFees": 38,
      "useAccountRevenueShare": true,
      "netIncomeFormula": "fare_accommodation + fare_cleaning - cha…",
      "netIncome": 580.94,
      "commissionFormula": "net_income",
      "commission": 580.94,
      "commissionTaxPercentage": 0,
      "commissionTax": 0,
      "commissionIncTax": 580.94,
      "ownerRevenueFormula": "net_income - pm_commission",
      "ownerRevenue": 0,
      "channelCommissionRules": {
        "tax": 0,
        "_id": "6aa525a85bc172bf24771be5"
      },
      "currencyConversionRateToAccount": 1,
      "channelAfBreakdown": [],
      "deductedFees": [],
      "altered": false,
      "isPrePaid": true,
      "version": 4,
      "bundledFees": [],
      "createdAt": "2026-09-12T09:10:03.963Z",
      "updatedAt": "2026-09-12T10:12:56.318Z",
      "__v": 0,
      "settingsSnapshot": {
        "_id": "6aa516eb52cf6521dc5854ff",
        "guestsIncludedInRegularFee": 1,
        "extraPersonFee": 10,
        "channelCommission": {
          "manual": [],
          "rule": "{…}"
        },
        "taxes": [
          "{…}",
          "…2 items"
        ],
        "financials": {
          "channelCommission": "{…}"
        },
        "monthlyPriceFactor": 0.85,
        "weeklyPriceFactor": 0.93,
        "useAccountRevenueShare": true,
        "useAccountAdditionalFees": true,
        "cleaningFeeFormula": {
          "value": "{…}",
          "lastUpdated": "2026-06-02T11:24:49.155Z"
        },
        "additionalFees": [],
        "channelAdditionalFees": [],
        "currency": {
          "from": "EUR",
          "to": "EUR",
          "rateDate": "2026-09-12T09:10:03.822Z",
          "rate": 1
        },
        "markup": {
          "amount": 15,
          "units": "PERCENTAGE"
        },
        "separateAfToSeveralInvoiceItems": true,
        "useDeductedTaxesFormula": true,
        "isTaxesPerLineItemReservation": true,
        "isDeductedFeesV2Enabled": true,
        "extractInclusiveTaxesEnabled": false,
        "extractManualInclusiveTaxesEnabled": false,
        "isDeductMarkupOnFeesEnabled": true,
        "isChannelSpecificTaxesReservation": false,
        "isChannelCommissionTaxBreakdownEnabled": true,
        "isInclusiveTaxAdjustmentsEnabled": false,
        "reservationId": "6aa516eb4b0afa5c8ca1c984",
        "stayIndex": 0,
        "listingId": "6a2befa5ed0c9600117d7e48",
        "accountId": "682f39ceca0d576ff1aa1da7",
        "moneyId": "6aa516eb52cf6521dc5854e6",
        "createdAt": "2026-09-12T09:10:03.969Z",
        "updatedAt": "2026-09-12T10:12:56.364Z",
        "__v": 0
      }
    }
  },
  "…1 items"
]
```

## reservations-by-listing

```json
{
  "results": [
    {
      "reservationId": "6a9a3aa96bba7f1c859f0fb9",
      "confirmationCode": "HMM8X4S5WZ",
      "status": "confirmed",
      "guestId": "6a9a3aa8a5600e7f34b11d68",
      "checkIn": "2026-10-05T16:00:00.000Z",
      "checkOut": "2026-10-08T11:00:00.000Z",
      "checkInDateLocalized": "2026-10-05",
      "checkOutDateLocalized": "2026-10-08",
      "source": "airbnb2",
      "channel": "airbnb2",
      "createdAt": "2026-09-04T03:27:37.394Z",
      "bookingDate": "2026-09-04T03:27:02.708Z",
      "notes": {},
      "stay": [
        {
          "listingId": "68592546458130001380dfc6",
          "checkIn": "2026-10-05T16:00:00.000Z",
          "checkOut": "2026-10-08T11:00:00.000Z",
          "checkInDateLocalized": "2026-10-05",
          "checkOutDateLocalized": "2026-10-08",
          "guestsCount": 1,
          "numberOfGuests": "{…}"
        },
        "…1 items"
      ],
      "guestStay": {
        "status": "not_set",
        "createdAt": "2026-09-04T03:27:37.394Z",
        "updatedAt": "2026-09-04T03:27:37.394Z"
      },
      "unifiedId": "v1-68592536afdc1ad47321e24b-2656516419",
      "channelMetadata": {
        "externalReservationId": "HMM8X4S5WZ",
        "externalListingId": "782454933950773204",
        "createdAt": "2026-09-04T03:27:02.708Z",
        "confirmedAt": "2026-09-04T03:27:08.929Z",
        "cancellationTerms": {
          "penaltyAmount": "67.00",
          "reasons": [
            "{…}",
            "…7 items"
          ]
        },
        "cancellationPolicy": "flexible"
      }
    },
    "…3 items"
  ],
  "pagination": {
    "skip": 0,
    "limit": 3,
    "hasMore": true
  }
}
```

## calendar-batch

```json
{
  "status": 200,
  "data": {
    "days": [
      {
        "date": "2026-10-02",
        "listingId": "68592546458130001380dfc6",
        "currency": "EUR",
        "price": 74,
        "isBasePrice": false,
        "basePrice": 90,
        "minNights": 2,
        "isBaseMinNights": false,
        "baseMinNights": 2,
        "maxNights": 90,
        "status": "booked",
        "blocks": {
          "m": false,
          "r": false,
          "b": true,
          "bd": false,
          "sr": false,
          "abl": false,
          "a": false,
          "bw": false,
          "o": false,
          "pt": false,
          "an": true
        },
        "blockRefs": [
          "{…}",
          "…2 items"
        ],
        "reservationId": "6aa84edfe75c0b7304fdebf3",
        "reservation": {
          "_id": "6aa84edfe75c0b7304fdebf3",
          "listingId": "68592546458130001380dfc6",
          "accountId": "682f39ceca0d576ff1aa1da7",
          "checkInDateLocalized": "2026-10-01",
          "checkOutDateLocalized": "2026-10-05",
          "status": "confirmed",
          "confirmationCode": "BC-KkoWnPEZl",
          "source": "Booking.com",
          "listing": "{…}",
          "money": "{…}",
          "nightsCount": 4,
          "plannedArrival": "16:00",
          "plannedDeparture": "11:00",
          "guest": "{…}",
          "guestsCount": 2,
          "integration": "{…}",
          "checkIn": "2026-10-01T16:00:00+00:00",
          "checkOut": "2026-10-05T11:00:00+00:00",
          "createdAt": "2026-09-14T19:45:35.000Z",
          "reservedExpiresAt": null,
          "notes": "{…}",
          "createdBy": "ChannelService",
          "numberOfGuests": "{…}",
          "earlyCheckIn": "{…}",
          "lateCheckOut": "{…}",
          "guestStay": "{…}",
          "propertyLock": "{…}",
          "browserCheckIn": "2026-10-01 18:00",
          "browserCheckOut": "2026-10-05 13:00"
        },
        "cta": false,
        "ctd": false,
        "requestToBook": false,
        "notDefaultAvailability": true,
        "isBaseRestrictions": true,
        "by": {
          "minNights": "{…}",
          "price": "{…}"
        }
      },
      "…8 items"
    ]
  },
  "message": "OK"
}
```

Requests sent: 11