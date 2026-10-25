# Summary (mean ± std over seeds)

profile=v2  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=False

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble p97) | 44.400 ± 5.835 | 23.300 ± 7.846 | 21.300 ± 6.767 | 2.000 ± 1.826 | 0.917 ± 0.066 | 0.477 ± 0.129 | 0.618 ± 0.103 | 27.538 ± 9.136 | 1.000 ± 0.000 | 0.714 ± 0.086 |
| temporal-test | Votes>=4 (legacy rule) | 44.400 ± 5.835 | 35.500 ± 8.885 | 29.700 ± 6.800 | 5.800 ± 2.440 | 0.841 ± 0.041 | 0.665 ± 0.100 | 0.738 ± 0.065 | 41.932 ± 9.932 | 1.000 ± 0.000 | nan |
| temporal-test | IForest only (p97) | 44.400 ± 5.835 | 24.300 ± 8.564 | 22.200 ± 7.480 | 2.100 ± 2.079 | 0.916 ± 0.062 | 0.493 ± 0.134 | 0.631 ± 0.106 | 28.697 ± 9.948 | 1.000 ± 0.000 | 0.704 ± 0.088 |
| temporal-test | LSTM only (p99) | 44.400 ± 5.835 | 24.000 ± 5.925 | 6.200 ± 3.393 | 17.800 ± 4.341 | 0.250 ± 0.110 | 0.138 ± 0.068 | 0.176 ± 0.084 | 28.376 ± 6.689 | 1.000 ± 0.000 | 0.197 ± 0.057 |
| temporal-test | DeepLog-style (budget-matched g) | 44.400 ± 5.835 | 23.200 ± 6.443 | 3.400 ± 1.713 | 19.800 ± 6.321 | 0.159 ± 0.083 | 0.077 ± 0.039 | 0.101 ± 0.049 | 27.487 ± 7.670 | 1.000 ± 0.000 | 0.106 ± 0.019 |
| temporal-test | Deployed P1+P2 | 44.400 ± 5.835 | 43.700 ± 8.460 | 24.100 ± 6.707 | 19.600 ± 4.742 | 0.548 ± 0.088 | 0.539 ± 0.116 | 0.541 ± 0.095 | 51.657 ± 9.293 | 0.956 ± 0.068 | nan |
| temporal-test | Supervised LR (train+val labels) | 44.400 ± 5.835 | 70.800 ± 11.429 | 33.900 ± 7.094 | 36.900 ± 5.567 | 0.476 ± 0.043 | 0.760 ± 0.097 | 0.585 ± 0.057 | 83.701 ± 12.356 | 0.631 ± 0.055 | 0.749 ± 0.073 |
| temporal-test | Supervised SVM (train+val labels) | 44.400 ± 5.835 | 64.100 ± 17.458 | 33.600 ± 7.043 | 30.500 ± 14.042 | 0.541 ± 0.120 | 0.754 ± 0.102 | 0.620 ± 0.078 | 75.852 ± 20.512 | 0.723 ± 0.181 | 0.587 ± 0.118 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 243.200 ± 2.616 | 389.700 ± 12.266 | 190.400 ± 3.534 | 199.300 ± 11.576 | 0.489 ± 0.015 | 0.783 ± 0.009 | 0.602 ± 0.013 | 89.372 ± 1.980 | 0.625 ± 0.018 | 0.765 ± 0.020 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 243.200 ± 2.616 | 361.400 ± 64.768 | 188.700 ± 5.599 | 172.700 ± 60.504 | 0.536 ± 0.091 | 0.776 ± 0.023 | 0.629 ± 0.056 | 82.943 ± 15.030 | 0.694 ± 0.131 | 0.597 ± 0.068 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4404.0 | 245.0 | 149.0 | 48.0 | 48.0 | 857.0 | 10.0 | 50.0 | 13.5 |
| 2.0 | 4422.0 | 246.0 | 143.0 | 57.0 | 46.0 | 855.0 | 11.0 | 50.0 | 10.2 |
| 3.0 | 4227.0 | 239.0 | 152.0 | 54.0 | 33.0 | 814.0 | 10.0 | 50.0 | 9.8 |
| 4.0 | 4384.0 | 244.0 | 154.0 | 48.0 | 42.0 | 845.0 | 8.0 | 60.0 | 9.5 |
| 5.0 | 4373.0 | 245.0 | 157.0 | 47.0 | 41.0 | 850.0 | 9.0 | 50.0 | 10.0 |
| 6.0 | 4302.0 | 242.0 | 150.0 | 48.0 | 44.0 | 823.0 | 8.0 | 50.0 | 9.5 |
| 7.0 | 4302.0 | 242.0 | 158.0 | 40.0 | 44.0 | 836.0 | 10.0 | 50.0 | 9.7 |
| 8.0 | 4438.0 | 242.0 | 138.0 | 48.0 | 56.0 | 875.0 | 10.0 | 50.0 | 10.1 |
| 9.0 | 4378.0 | 240.0 | 139.0 | 54.0 | 47.0 | 845.0 | 10.0 | 50.0 | 9.9 |
| 10.0 | 4369.0 | 247.0 | 154.0 | 50.0 | 43.0 | 845.0 | 10.0 | 50.0 | 10.1 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 85.9 | 0.388 | 0.742 | 0.525 | 101.649 |
| P1+P2 | 90.0 | 100.7 | 0.33 | 0.747 | 0.443 | 119.15 |
| P1 | 93.0 | 54.6 | 0.59 | 0.726 | 0.822 | 64.582 |
| P1+P2 | 93.0 | 70.5 | 0.458 | 0.73 | 0.631 | 83.395 |
| P1 | 95.0 | 39.0 | 0.802 | 0.695 | 0.981 | 46.087 |
| P1+P2 | 95.0 | 56.6 | 0.55 | 0.702 | 0.791 | 66.909 |
| P1 | 97.0 | 23.3 | 0.917 | 0.477 | 1.0 | 27.538 |
| P1+P2 | 97.0 | 43.7 | 0.548 | 0.539 | 0.956 | 51.657 |
| P1 | 98.0 | 16.5 | 0.936 | 0.346 | 1.0 | 19.513 |
| P1+P2 | 98.0 | 37.5 | 0.498 | 0.421 | 0.989 | 44.336 |
| P1 | 99.0 | 9.0 | 0.943 | 0.19 | 1.0 | 10.625 |
| P1+P2 | 99.0 | 31.1 | 0.402 | 0.288 | 1.0 | 36.757 |
| P1 | 99.5 | 5.2 | 0.952 | 0.108 | 1.0 | 6.121 |
| P1+P2 | 99.5 | 28.1 | 0.345 | 0.223 | 1.0 | 33.201 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble p97) | bigram_violation | 66 | 2 | 0.03 |
| P1 (ensemble p97) | broad_access | 64 | 40 | 0.625 |
| P1 (ensemble p97) | consent_probe | 72 | 41 | 0.569 |
| P1 (ensemble p97) | cross_org_denied | 61 | 35 | 0.574 |
| P1 (ensemble p97) | dispense_without_read | 56 | 36 | 0.643 |
| P1 (ensemble p97) | off_hours_burst | 63 | 58 | 0.921 |
| P1 (ensemble p97) | order_composition | 62 | 1 | 0.016 |
| LSTM only (p99) | bigram_violation | 66 | 0 | 0.0 |
| LSTM only (p99) | broad_access | 64 | 7 | 0.109 |
| LSTM only (p99) | consent_probe | 72 | 25 | 0.347 |
| LSTM only (p99) | cross_org_denied | 61 | 21 | 0.344 |
| LSTM only (p99) | dispense_without_read | 56 | 1 | 0.018 |
| LSTM only (p99) | off_hours_burst | 63 | 3 | 0.048 |
| LSTM only (p99) | order_composition | 62 | 5 | 0.081 |
| DeepLog-style (budget-matched g) | bigram_violation | 66 | 0 | 0.0 |
| DeepLog-style (budget-matched g) | broad_access | 64 | 9 | 0.141 |
| DeepLog-style (budget-matched g) | consent_probe | 72 | 4 | 0.056 |
| DeepLog-style (budget-matched g) | cross_org_denied | 61 | 5 | 0.082 |
| DeepLog-style (budget-matched g) | dispense_without_read | 56 | 0 | 0.0 |
| DeepLog-style (budget-matched g) | off_hours_burst | 63 | 5 | 0.079 |
| DeepLog-style (budget-matched g) | order_composition | 62 | 11 | 0.177 |
| Deployed P1+P2 | bigram_violation | 66 | 2 | 0.03 |
| Deployed P1+P2 | broad_access | 64 | 40 | 0.625 |
| Deployed P1+P2 | consent_probe | 72 | 56 | 0.778 |
| Deployed P1+P2 | cross_org_denied | 61 | 44 | 0.721 |
| Deployed P1+P2 | dispense_without_read | 56 | 36 | 0.643 |
| Deployed P1+P2 | off_hours_burst | 63 | 58 | 0.921 |
| Deployed P1+P2 | order_composition | 62 | 5 | 0.081 |
| Supervised LR (train+val labels) | bigram_violation | 66 | 9 | 0.136 |
| Supervised LR (train+val labels) | broad_access | 64 | 64 | 1.0 |
| Supervised LR (train+val labels) | consent_probe | 72 | 72 | 1.0 |
| Supervised LR (train+val labels) | cross_org_denied | 61 | 61 | 1.0 |
| Supervised LR (train+val labels) | dispense_without_read | 56 | 56 | 1.0 |
| Supervised LR (train+val labels) | off_hours_burst | 63 | 61 | 0.968 |
| Supervised LR (train+val labels) | order_composition | 62 | 16 | 0.258 |
