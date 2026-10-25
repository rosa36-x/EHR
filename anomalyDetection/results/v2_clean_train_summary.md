# Summary (mean ± std over seeds)

profile=v2  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=True

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble p97) | 44.400 ± 5.835 | 22.900 ± 7.218 | 21.500 ± 6.468 | 1.400 ± 1.578 | 0.942 ± 0.059 | 0.479 ± 0.110 | 0.627 ± 0.090 | 27.044 ± 8.306 | 1.000 ± 0.000 | 0.714 ± 0.075 |
| temporal-test | Votes>=4 (legacy rule) | 44.400 ± 5.835 | 48.900 ± 8.306 | 29.200 ± 6.779 | 19.700 ± 4.218 | 0.595 ± 0.073 | 0.653 ± 0.090 | 0.621 ± 0.074 | 57.813 ± 9.180 | 0.905 ± 0.071 | nan |
| temporal-test | IForest only (p97) | 44.400 ± 5.835 | 23.700 ± 6.255 | 20.600 ± 5.700 | 3.100 ± 2.079 | 0.870 ± 0.096 | 0.460 ± 0.101 | 0.596 ± 0.091 | 28.006 ± 7.161 | 1.000 ± 0.000 | 0.645 ± 0.081 |
| temporal-test | LSTM only (p99) | 44.400 ± 5.835 | 28.600 ± 3.777 | 9.300 ± 4.111 | 19.300 ± 2.497 | 0.318 ± 0.105 | 0.205 ± 0.070 | 0.248 ± 0.083 | 33.833 ± 4.057 | 1.000 ± 0.000 | 0.295 ± 0.096 |
| temporal-test | DeepLog-style (budget-matched g) | 44.400 ± 5.835 | 27.100 ± 6.226 | 20.400 ± 5.502 | 6.700 ± 3.713 | 0.756 ± 0.123 | 0.455 ± 0.075 | 0.565 ± 0.081 | 32.039 ± 6.936 | 1.000 ± 0.000 | 0.626 ± 0.115 |
| temporal-test | Deployed P1+P2 | 44.400 ± 5.835 | 44.000 ± 6.164 | 23.700 ± 7.103 | 20.300 ± 2.312 | 0.529 ± 0.094 | 0.527 ± 0.119 | 0.527 ± 0.102 | 52.047 ± 6.775 | 0.963 ± 0.059 | nan |
| temporal-test | Supervised LR (train+val labels) | 44.400 ± 5.835 | 70.800 ± 11.429 | 33.900 ± 7.094 | 36.900 ± 5.567 | 0.476 ± 0.043 | 0.760 ± 0.097 | 0.585 ± 0.057 | 83.701 ± 12.356 | 0.631 ± 0.055 | 0.749 ± 0.073 |
| temporal-test | Supervised SVM (train+val labels) | 44.400 ± 5.835 | 64.100 ± 17.458 | 33.600 ± 7.043 | 30.500 ± 14.042 | 0.541 ± 0.120 | 0.754 ± 0.102 | 0.620 ± 0.078 | 75.852 ± 20.512 | 0.723 ± 0.181 | 0.587 ± 0.118 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 243.200 ± 2.616 | 389.700 ± 12.266 | 190.400 ± 3.534 | 199.300 ± 11.576 | 0.489 ± 0.015 | 0.783 ± 0.009 | 0.602 ± 0.013 | 89.372 ± 1.980 | 0.625 ± 0.018 | 0.765 ± 0.020 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 243.200 ± 2.616 | 361.400 ± 64.768 | 188.700 ± 5.599 | 172.700 ± 60.504 | 0.536 ± 0.091 | 0.776 ± 0.023 | 0.629 ± 0.056 | 82.943 ± 15.030 | 0.694 ± 0.131 | 0.597 ± 0.068 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4404.0 | 245.0 | 149.0 | 48.0 | 48.0 | 857.0 | 9.0 | 60.0 | 13.0 |
| 2.0 | 4422.0 | 246.0 | 143.0 | 57.0 | 46.0 | 855.0 | 9.0 | 130.0 | 9.9 |
| 3.0 | 4227.0 | 239.0 | 152.0 | 54.0 | 33.0 | 814.0 | 8.0 | 130.0 | 9.4 |
| 4.0 | 4384.0 | 244.0 | 154.0 | 48.0 | 42.0 | 845.0 | 7.0 | 100.0 | 9.3 |
| 5.0 | 4373.0 | 245.0 | 157.0 | 47.0 | 41.0 | 850.0 | 8.0 | 130.0 | 9.9 |
| 6.0 | 4302.0 | 242.0 | 150.0 | 48.0 | 44.0 | 823.0 | 9.0 | 100.0 | 9.6 |
| 7.0 | 4302.0 | 242.0 | 158.0 | 40.0 | 44.0 | 836.0 | 11.0 | 130.0 | 9.9 |
| 8.0 | 4438.0 | 242.0 | 138.0 | 48.0 | 56.0 | 875.0 | 11.0 | 130.0 | 10.6 |
| 9.0 | 4378.0 | 240.0 | 139.0 | 54.0 | 47.0 | 845.0 | 8.0 | 130.0 | 9.5 |
| 10.0 | 4369.0 | 247.0 | 154.0 | 50.0 | 43.0 | 845.0 | 8.0 | 100.0 | 9.8 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 81.7 | 0.411 | 0.749 | 0.552 | 96.75 |
| P1+P2 | 90.0 | 96.6 | 0.353 | 0.765 | 0.463 | 114.394 |
| P1 | 93.0 | 53.8 | 0.583 | 0.706 | 0.833 | 63.64 |
| P1+P2 | 93.0 | 70.8 | 0.451 | 0.722 | 0.628 | 83.797 |
| P1 | 95.0 | 38.9 | 0.784 | 0.68 | 0.983 | 45.989 |
| P1+P2 | 95.0 | 57.8 | 0.536 | 0.7 | 0.772 | 68.39 |
| P1 | 97.0 | 22.9 | 0.942 | 0.479 | 1.0 | 27.044 |
| P1+P2 | 97.0 | 44.0 | 0.529 | 0.527 | 0.963 | 52.047 |
| P1 | 98.0 | 18.1 | 0.961 | 0.386 | 1.0 | 21.357 |
| P1+P2 | 98.0 | 39.6 | 0.486 | 0.437 | 0.987 | 46.838 |
| P1 | 99.0 | 10.8 | 0.947 | 0.227 | 1.0 | 12.736 |
| P1+P2 | 99.0 | 33.8 | 0.406 | 0.312 | 1.0 | 39.984 |
| P1 | 99.5 | 5.6 | 0.947 | 0.118 | 1.0 | 6.604 |
| P1+P2 | 99.5 | 31.6 | 0.371 | 0.268 | 1.0 | 37.375 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble p97) | bigram_violation | 66 | 2 | 0.03 |
| P1 (ensemble p97) | broad_access | 64 | 41 | 0.641 |
| P1 (ensemble p97) | consent_probe | 72 | 63 | 0.875 |
| P1 (ensemble p97) | cross_org_denied | 61 | 40 | 0.656 |
| P1 (ensemble p97) | dispense_without_read | 56 | 9 | 0.161 |
| P1 (ensemble p97) | off_hours_burst | 63 | 60 | 0.952 |
| P1 (ensemble p97) | order_composition | 62 | 0 | 0.0 |
| LSTM only (p99) | bigram_violation | 66 | 4 | 0.061 |
| LSTM only (p99) | broad_access | 64 | 4 | 0.062 |
| LSTM only (p99) | consent_probe | 72 | 55 | 0.764 |
| LSTM only (p99) | cross_org_denied | 61 | 16 | 0.262 |
| LSTM only (p99) | dispense_without_read | 56 | 3 | 0.054 |
| LSTM only (p99) | off_hours_burst | 63 | 5 | 0.079 |
| LSTM only (p99) | order_composition | 62 | 6 | 0.097 |
| DeepLog-style (budget-matched g) | bigram_violation | 66 | 37 | 0.561 |
| DeepLog-style (budget-matched g) | broad_access | 64 | 1 | 0.016 |
| DeepLog-style (budget-matched g) | consent_probe | 72 | 70 | 0.972 |
| DeepLog-style (budget-matched g) | cross_org_denied | 61 | 51 | 0.836 |
| DeepLog-style (budget-matched g) | dispense_without_read | 56 | 36 | 0.643 |
| DeepLog-style (budget-matched g) | off_hours_burst | 63 | 9 | 0.143 |
| DeepLog-style (budget-matched g) | order_composition | 62 | 0 | 0.0 |
| Deployed P1+P2 | bigram_violation | 66 | 6 | 0.091 |
| Deployed P1+P2 | broad_access | 64 | 41 | 0.641 |
| Deployed P1+P2 | consent_probe | 72 | 69 | 0.958 |
| Deployed P1+P2 | cross_org_denied | 61 | 43 | 0.705 |
| Deployed P1+P2 | dispense_without_read | 56 | 12 | 0.214 |
| Deployed P1+P2 | off_hours_burst | 63 | 60 | 0.952 |
| Deployed P1+P2 | order_composition | 62 | 6 | 0.097 |
| Supervised LR (train+val labels) | bigram_violation | 66 | 9 | 0.136 |
| Supervised LR (train+val labels) | broad_access | 64 | 64 | 1.0 |
| Supervised LR (train+val labels) | consent_probe | 72 | 72 | 1.0 |
| Supervised LR (train+val labels) | cross_org_denied | 61 | 61 | 1.0 |
| Supervised LR (train+val labels) | dispense_without_read | 56 | 56 | 1.0 |
| Supervised LR (train+val labels) | off_hours_burst | 63 | 61 | 0.968 |
| Supervised LR (train+val labels) | order_composition | 62 | 16 | 0.258 |
